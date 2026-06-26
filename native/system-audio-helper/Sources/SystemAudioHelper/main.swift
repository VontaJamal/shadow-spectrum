import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

private let visualBandCount = 24
private let historyWindowSeconds = 8.0
private let onsetDensityWindowSeconds = 6.0
private let minimumBandFrequency = 35.0

private struct TimedValue {
  let time: Double
  let value: Double
}

private struct FeaturePayload: Encodable {
  let type: String
  let features: AudioFeatures
}

private struct StatusPayload: Encodable {
  let type: String
  let status: String
  let message: String
}

private struct AudioFeatures: Encodable {
  let timestampMs: Double
  let rms: Double
  let bass: Double
  let mid: Double
  let treble: Double
  let centroid: Double
  let beatPulse: Double
  let energy: Double
  let spectralFlux: Double
  let spectralFlatness: Double
  let spectralRolloff: Double
  let dynamicRange: Double
  let onsetPulse: Double
  let bassPulse: Double
  let midPulse: Double
  let treblePulse: Double
  let frequencyBins: [Double]
  let waveform: [Double]
  let bands: [Double]
  let bandEnvelopes: [Double]
  let bandPeaks: [Double]
  let bandTransients: [Double]
  let slowBands: [Double]
  let novelty: Double
  let onsetDensity: Double
  let loudnessTrend: Double
  let isSilent: Bool
}

private final class JsonLineWriter {
  private let encoder = JSONEncoder()
  private let lock = NSLock()

  func status(_ status: String, _ message: String) {
    write(StatusPayload(type: "status", status: status, message: message))
  }

  func features(_ features: AudioFeatures) {
    write(FeaturePayload(type: "features", features: features))
  }

  private func write<T: Encodable>(_ payload: T) {
    guard let data = try? encoder.encode(payload) else {
      return
    }

    lock.lock()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
    lock.unlock()
  }
}

@available(macOS 13.0, *)
private final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
  private let output = JsonLineWriter()
  private let sampleQueue = DispatchQueue(label: "dev.codex.spectra-drift.system-audio.samples")
  private let analysisQueue = DispatchQueue(label: "dev.codex.spectra-drift.system-audio.analysis")
  private var stream: SCStream?
  private var samples: [Double] = []
  private var bandEnvelopes = Array(repeating: 0.0, count: visualBandCount)
  private var bandPeaks = Array(repeating: 0.0, count: visualBandCount)
  private var bandTransients = Array(repeating: 0.0, count: visualBandCount)
  private var slowBands = Array(repeating: 0.0, count: visualBandCount)
  private var previousBands = Array(repeating: 0.0, count: visualBandCount)
  private var previousFrequencyBins: [Double] = []
  private var energyHistory: [TimedValue] = []
  private var bassHistory: [TimedValue] = []
  private var midHistory: [TimedValue] = []
  private var trebleHistory: [TimedValue] = []
  private var onsetHistory: [Double] = []
  private var previousOnsetPulse = 0.0
  private var previousBassPulse = 0.0
  private var previousMidPulse = 0.0
  private var previousTreblePulse = 0.0
  private var lastEmit = DispatchTime.now()
  private var lastFeatureTime = DispatchTime.now()
  private var configuredSampleRate = 48_000.0

  func start() async {
    do {
      output.status("requesting", "Requesting macOS system audio")

      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
      guard let display = content.displays.first else {
        throw CaptureError("No display is available for system audio capture")
      }

      let configuration = SCStreamConfiguration()
      configuration.width = 2
      configuration.height = 2
      configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
      configuration.queueDepth = 1
      configuration.capturesAudio = true
      configuration.excludesCurrentProcessAudio = true
      configuration.sampleRate = Int(configuredSampleRate)
      configuration.channelCount = 2

      let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
      let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
      try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)
      self.stream = stream

      try await stream.startCapture()
      output.status("active", "System audio active")
    } catch {
      output.status("error", readableError(error))
      Foundation.exit(1)
    }
  }

  func stop() async {
    guard let stream else {
      return
    }

    try? await stream.stopCapture()
    self.stream = nil
  }

  nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
    output.status("error", readableError(error))
    Foundation.exit(1)
  }

  nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .audio, sampleBuffer.isValid else {
      return
    }

    append(sampleBuffer)
  }

  private func append(_ sampleBuffer: CMSampleBuffer) {
    guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
      let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)
    else {
      return
    }

    configuredSampleRate = Double(streamDescription.pointee.mSampleRate)

    var neededSize = 0
    var blockBuffer: CMBlockBuffer?
    CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer,
      bufferListSizeNeededOut: &neededSize,
      bufferListOut: nil,
      bufferListSize: 0,
      blockBufferAllocator: nil,
      blockBufferMemoryAllocator: nil,
      flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
      blockBufferOut: &blockBuffer
    )

    guard neededSize > 0 else {
      return
    }

    let rawBuffer = UnsafeMutableRawPointer.allocate(
      byteCount: neededSize,
      alignment: MemoryLayout<AudioBufferList>.alignment
    )
    defer {
      rawBuffer.deallocate()
    }

    let audioBufferList = rawBuffer.bindMemory(to: AudioBufferList.self, capacity: 1)
    let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer,
      bufferListSizeNeededOut: nil,
      bufferListOut: audioBufferList,
      bufferListSize: neededSize,
      blockBufferAllocator: nil,
      blockBufferMemoryAllocator: nil,
      flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
      blockBufferOut: &blockBuffer
    )

    guard status == noErr else {
      return
    }

    let audioBuffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
    var mixed: [Double] = []

    for buffer in audioBuffers {
      guard let data = buffer.mData else {
        continue
      }

      let byteCount = Int(buffer.mDataByteSize)
      let isFloat = (streamDescription.pointee.mFormatFlags & kAudioFormatFlagIsFloat) != 0
      let isSignedInteger = (streamDescription.pointee.mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0

      if isFloat {
        let pointer = data.assumingMemoryBound(to: Float.self)
        let count = byteCount / MemoryLayout<Float>.size
        for index in 0..<count {
          mixed.append(Double(pointer[index]))
        }
      } else if isSignedInteger {
        let pointer = data.assumingMemoryBound(to: Int16.self)
        let count = byteCount / MemoryLayout<Int16>.size
        for index in 0..<count {
          mixed.append(Double(pointer[index]) / Double(Int16.max))
        }
      }
    }

    guard !mixed.isEmpty else {
      return
    }

    let capturedSamples = mixed
    analysisQueue.async {
      self.samples.append(contentsOf: capturedSamples)
      let maximumSamples = 4_096
      if self.samples.count > maximumSamples {
        self.samples.removeFirst(self.samples.count - maximumSamples)
      }

      let now = DispatchTime.now()
      let elapsed = Double(now.uptimeNanoseconds - self.lastEmit.uptimeNanoseconds) / 1_000_000_000
      if elapsed >= 1.0 / 30.0 {
        self.lastEmit = now
        self.output.features(self.extractFeatures())
      }
    }
  }

  private func extractFeatures() -> AudioFeatures {
    let now = DispatchTime.now()
    let timestampMs = Double(now.uptimeNanoseconds) / 1_000_000
    let timestampSeconds = timestampMs / 1_000
    let deltaSeconds = min(0.25, max(1.0 / 240.0, Double(now.uptimeNanoseconds - lastFeatureTime.uptimeNanoseconds) / 1_000_000_000))
    lastFeatureTime = now
    let windowSize = min(1_024, samples.count)
    guard windowSize > 32 else {
      return silentFeatures(timestampMs: timestampMs)
    }

    let window = Array(samples.suffix(windowSize))
    let rms = sqrt(window.reduce(0.0) { $0 + $1 * $1 } / Double(window.count))
    let bins = makeFrequencyBins(window, binCount: 96)
    let bass = averageBand(bins, minFrequency: 20, maxFrequency: 250)
    let mid = averageBand(bins, minFrequency: 250, maxFrequency: 4_000)
    let treble = averageBand(bins, minFrequency: 4_000, maxFrequency: configuredSampleRate / 2)
    let centroid = spectralCentroid(bins)
    let bands = makeLogBands(bins, count: visualBandCount)
    let averageBandEnergy = average(bands)
    let energy = clamp(rms * 1.2 + averageBandEnergy * 0.68 + bass * 0.28)
    let flux = spectralFlux(bins, previousFrequencyBins)
    let flatness = spectralFlatness(bins)
    let rolloff = spectralRolloff(bins, threshold: 0.85)
    let dynamicRange = calculateDynamicRange(window, rms: rms)
    let bandProfileDelta = calculateBandProfileDelta(bands, previousBands)
    let loudnessTrend = normalizedTrend(energy, history: energyHistory)
    let novelty = clamp(flux * 0.42 + bandProfileDelta * 0.95 + max(0, loudnessTrend) * 0.26 + dynamicRange * 0.08)
    let onsetPulse = adaptivePulse(
      energy + flux * 0.35 + novelty * 0.16,
      history: energyHistory,
      previousPulse: previousOnsetPulse,
      floor: 0.018,
      sensitivity: 1.35,
      spreadScale: 1.65
    )
    let bassPulse = adaptivePulse(
      bass,
      history: bassHistory,
      previousPulse: previousBassPulse,
      floor: 0.014,
      sensitivity: 1.6,
      spreadScale: 1.45
    )
    let midPulse = adaptivePulse(
      mid,
      history: midHistory,
      previousPulse: previousMidPulse,
      floor: 0.016,
      sensitivity: 1.28,
      spreadScale: 1.55
    )
    let treblePulse = adaptivePulse(
      treble,
      history: trebleHistory,
      previousPulse: previousTreblePulse,
      floor: 0.016,
      sensitivity: 1.22,
      spreadScale: 1.55
    )
    let beatPulse = clamp(max(bassPulse, onsetPulse * 0.78))

    updateBandEnvelopeState(bands, deltaSeconds: deltaSeconds)
    updateBandTransientState(bands, deltaSeconds: deltaSeconds)
    updateSlowBandState(bands, deltaSeconds: deltaSeconds)
    if onsetPulse > 0.18 || bassPulse > 0.28 {
      onsetHistory.append(timestampSeconds)
    }
    pruneOnsets(timestampSeconds)
    let onsetDensity = clamp(Double(onsetHistory.count) / 12.0)
    pushHistory(&energyHistory, energy, timestampSeconds)
    pushHistory(&bassHistory, bass, timestampSeconds)
    pushHistory(&midHistory, mid, timestampSeconds)
    pushHistory(&trebleHistory, treble, timestampSeconds)
    previousFrequencyBins = bins
    previousBands = bands
    previousOnsetPulse = onsetPulse
    previousBassPulse = bassPulse
    previousMidPulse = midPulse
    previousTreblePulse = treblePulse

    return AudioFeatures(
      timestampMs: timestampMs,
      rms: clamp(rms * 1.5),
      bass: bass,
      mid: mid,
      treble: treble,
      centroid: centroid,
      beatPulse: beatPulse,
      energy: energy,
      spectralFlux: flux,
      spectralFlatness: flatness,
      spectralRolloff: rolloff,
      dynamicRange: dynamicRange,
      onsetPulse: onsetPulse,
      bassPulse: bassPulse,
      midPulse: midPulse,
      treblePulse: treblePulse,
      frequencyBins: bins,
      waveform: downsample(window, count: 128),
      bands: bands,
      bandEnvelopes: bandEnvelopes,
      bandPeaks: bandPeaks,
      bandTransients: bandTransients,
      slowBands: slowBands,
      novelty: novelty,
      onsetDensity: onsetDensity,
      loudnessTrend: loudnessTrend,
      isSilent: rms < 0.008 && energy < 0.012 && bass < 0.012
    )
  }

  private func makeFrequencyBins(_ window: [Double], binCount: Int) -> [Double] {
    var bins: [Double] = []
    bins.reserveCapacity(binCount)

    for bin in 0..<binCount {
      let frequency = Double(bin + 1) / Double(binCount) * (configuredSampleRate / 2)
      let radiansPerSample = 2.0 * Double.pi * frequency / configuredSampleRate
      var real = 0.0
      var imaginary = 0.0

      for index in 0..<window.count {
        let phase = radiansPerSample * Double(index)
        let taper = 0.5 - 0.5 * cos(2.0 * Double.pi * Double(index) / Double(window.count - 1))
        let sample = window[index] * taper
        real += sample * cos(phase)
        imaginary -= sample * sin(phase)
      }

      let magnitude = sqrt(real * real + imaginary * imaginary) / Double(window.count)
      bins.append(clamp(magnitude * 18.0))
    }

    return bins
  }

  private func averageBand(_ bins: [Double], minFrequency: Double, maxFrequency: Double) -> Double {
    let nyquist = configuredSampleRate / 2
    let start = max(0, Int((minFrequency / nyquist) * Double(bins.count)))
    let end = min(bins.count - 1, Int((maxFrequency / nyquist) * Double(bins.count)))

    guard end >= start else {
      return 0
    }

    let values = bins[start...end]
    return values.reduce(0, +) / Double(values.count)
  }

  private func makeLogBands(_ bins: [Double], count: Int) -> [Double] {
    let maximumFrequency = max(minimumBandFrequency + 1, configuredSampleRate / 2)
    let logMinimum = log10(minimumBandFrequency)
    let logMaximum = log10(maximumFrequency)

    return (0..<count).map { band in
      let startFrequency = pow(10, logMinimum + (Double(band) / Double(count)) * (logMaximum - logMinimum))
      let endFrequency = pow(10, logMinimum + (Double(band + 1) / Double(count)) * (logMaximum - logMinimum))
      return averageBand(bins, minFrequency: startFrequency, maxFrequency: endFrequency)
    }
  }

  private func spectralCentroid(_ bins: [Double]) -> Double {
    var weighted = 0.0
    var total = 0.0

    for index in 0..<bins.count {
      weighted += Double(index) * bins[index]
      total += bins[index]
    }

    guard total > 0 else {
      return 0
    }

    return clamp(weighted / total / Double(bins.count - 1))
  }

  private func spectralFlux(_ current: [Double], _ previous: [Double]) -> Double {
    guard current.count == previous.count else {
      return 0
    }

    var sum = 0.0
    for index in 0..<current.count {
      sum += max(0, current[index] - previous[index])
    }

    return clamp((sum / Double(max(1, current.count))) * 3.2)
  }

  private func spectralFlatness(_ bins: [Double]) -> Double {
    guard !bins.isEmpty else {
      return 0
    }

    let epsilon = 0.000_001
    var logSum = 0.0
    var arithmeticSum = 0.0

    for bin in bins {
      let magnitude = max(epsilon, bin)
      logSum += log(magnitude)
      arithmeticSum += magnitude
    }

    let geometricMean = exp(logSum / Double(bins.count))
    let arithmeticMean = arithmeticSum / Double(bins.count)
    return arithmeticMean <= epsilon ? 0 : clamp(geometricMean / arithmeticMean)
  }

  private func spectralRolloff(_ bins: [Double], threshold: Double) -> Double {
    let total = bins.reduce(0, +)
    guard total > 0, !bins.isEmpty else {
      return 0
    }

    let target = total * threshold
    var running = 0.0
    for index in 0..<bins.count {
      running += bins[index]
      if running >= target {
        return clamp(Double(index) / Double(max(1, bins.count - 1)))
      }
    }

    return 1
  }

  private func calculateDynamicRange(_ window: [Double], rms: Double) -> Double {
    let peak = window.reduce(0.0) { max($0, abs($1)) }
    return clamp((peak - rms) * 1.7)
  }

  private func adaptivePulse(
    _ value: Double,
    history: [TimedValue],
    previousPulse: Double,
    floor: Double,
    sensitivity: Double,
    spreadScale: Double
  ) -> Double {
    guard !history.isEmpty else {
      return 0
    }

    let baseline = average(history)
    let spread = sqrt(variance(history, mean: baseline))
    let threshold = baseline + spread * spreadScale + floor
    let lift = max(0, value - threshold)
    let normalizedLift = lift / max(floor * 1.6, spread + floor)
    return clamp(normalizedLift * sensitivity + previousPulse * 0.58)
  }

  private func calculateBandProfileDelta(_ current: [Double], _ previous: [Double]) -> Double {
    guard current.count == previous.count else {
      return 0
    }

    var sum = 0.0
    for index in 0..<current.count {
      sum += abs(current[index] - previous[index])
    }
    return clamp(sum / Double(max(1, current.count)))
  }

  private func updateBandEnvelopeState(_ bands: [Double], deltaSeconds: Double) {
    let attack = exponentialAlpha(deltaSeconds, timeConstant: 0.042)
    let release = exponentialAlpha(deltaSeconds, timeConstant: 0.36)
    let peakDecay = exp(-deltaSeconds / 1.9)
    for index in 0..<min(bands.count, bandEnvelopes.count) {
      let band = bands[index]
      let envelope = bandEnvelopes[index]
      bandEnvelopes[index] = lerp(envelope, band, band > envelope ? attack : release)
      bandPeaks[index] = max(band, bandPeaks[index] * peakDecay)
    }
  }

  private func updateBandTransientState(_ bands: [Double], deltaSeconds: Double) {
    let decay = exp(-deltaSeconds / 0.14)
    for index in 0..<min(bands.count, bandTransients.count) {
      let lift = max(0, bands[index] - previousBands[index])
      bandTransients[index] = max(lift * 1.8, bandTransients[index] * decay)
    }
  }

  private func updateSlowBandState(_ bands: [Double], deltaSeconds: Double) {
    let alpha = exponentialAlpha(deltaSeconds, timeConstant: 2.6)
    for index in 0..<min(bands.count, slowBands.count) {
      slowBands[index] = lerp(slowBands[index], bands[index], alpha)
    }
  }

  private func pushHistory(_ history: inout [TimedValue], _ value: Double, _ time: Double) {
    history.append(TimedValue(time: time, value: value))
    pruneHistory(&history, time)
  }

  private func pruneHistory(_ history: inout [TimedValue], _ time: Double) {
    let cutoff = time - historyWindowSeconds
    while let first = history.first, first.time < cutoff {
      history.removeFirst()
    }
  }

  private func pruneOnsets(_ time: Double) {
    let cutoff = time - onsetDensityWindowSeconds
    while let first = onsetHistory.first, first < cutoff {
      onsetHistory.removeFirst()
    }
  }

  private func average(_ values: [TimedValue]) -> Double {
    guard !values.isEmpty else {
      return 0
    }

    return values.reduce(0) { $0 + $1.value } / Double(values.count)
  }

  private func variance(_ values: [TimedValue], mean: Double) -> Double {
    guard !values.isEmpty else {
      return 0
    }

    return values.reduce(0) { partial, value in
      let delta = value.value - mean
      return partial + delta * delta
    } / Double(values.count)
  }

  private func average(_ values: [Double]) -> Double {
    guard !values.isEmpty else {
      return 0
    }

    return values.reduce(0, +) / Double(values.count)
  }

  private func normalizedTrend(_ value: Double, history: [TimedValue]) -> Double {
    guard history.count >= 2 else {
      return 0
    }

    let baseline = average(history)
    let spread = sqrt(variance(history, mean: baseline))
    return clamp((value - baseline) / max(0.035, spread + 0.02), min: -1, max: 1)
  }

  private func exponentialAlpha(_ deltaSeconds: Double, timeConstant: Double) -> Double {
    guard timeConstant > 0 else {
      return 1
    }
    return clamp(1 - exp(-max(0, deltaSeconds) / timeConstant))
  }

  private func downsample(_ values: [Double], count: Int) -> [Double] {
    guard !values.isEmpty else {
      return []
    }

    return (0..<count).map { index in
      let sourceIndex = Int(Double(index) / Double(max(1, count - 1)) * Double(values.count - 1))
      return clamp(values[sourceIndex], min: -1, max: 1)
    }
  }

  private func silentFeatures(timestampMs: Double = 0) -> AudioFeatures {
    AudioFeatures(
      timestampMs: timestampMs,
      rms: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      centroid: 0,
      beatPulse: 0,
      energy: 0,
      spectralFlux: 0,
      spectralFlatness: 0,
      spectralRolloff: 0,
      dynamicRange: 0,
      onsetPulse: 0,
      bassPulse: 0,
      midPulse: 0,
      treblePulse: 0,
      frequencyBins: Array(repeating: 0, count: 96),
      waveform: Array(repeating: 0, count: 128),
      bands: Array(repeating: 0, count: visualBandCount),
      bandEnvelopes: Array(repeating: 0, count: visualBandCount),
      bandPeaks: Array(repeating: 0, count: visualBandCount),
      bandTransients: Array(repeating: 0, count: visualBandCount),
      slowBands: Array(repeating: 0, count: visualBandCount),
      novelty: 0,
      onsetDensity: 0,
      loudnessTrend: 0,
      isSilent: true
    )
  }
}

@available(macOS 13.0, *)
extension SystemAudioCapture: @unchecked Sendable {}

private struct CaptureError: Error, CustomStringConvertible {
  let description: String

  init(_ description: String) {
    self.description = description
  }
}

private func readableError(_ error: Error) -> String {
  let nsError = error as NSError
  if nsError.domain == "com.apple.ScreenCaptureKit.SCStreamErrorDomain" || nsError.domain.contains("ScreenCapture") {
    return "macOS system audio permission is blocked. Allow Screen Recording for this app, then restart capture."
  }

  return error.localizedDescription
}

private func lerp(_ from: Double, _ to: Double, _ alpha: Double) -> Double {
  from + (to - from) * clamp(alpha)
}

private func clamp(_ value: Double, min: Double = 0, max: Double = 1) -> Double {
  Swift.min(max, Swift.max(min, value))
}

@main
private enum SystemAudioHelper {
  static func main() async {
    guard #available(macOS 13.0, *) else {
      JsonLineWriter().status("unsupported", "System audio capture requires macOS 13 or newer")
      Foundation.exit(1)
    }

    let capture = SystemAudioCapture()
    await capture.start()

    signal(SIGTERM) { _ in
      Foundation.exit(0)
    }

    signal(SIGINT) { _ in
      Foundation.exit(0)
    }

    while true {
      try? await Task.sleep(nanoseconds: 60_000_000_000)
    }
  }
}
