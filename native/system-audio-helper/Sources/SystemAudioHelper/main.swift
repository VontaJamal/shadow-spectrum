import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

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
  let rms: Double
  let bass: Double
  let mid: Double
  let treble: Double
  let centroid: Double
  let beatPulse: Double
  let frequencyBins: [Double]
  let waveform: [Double]
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
  private var previousBass = 0.0
  private var previousPulse = 0.0
  private var lastEmit = DispatchTime.now()
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
    let windowSize = min(1_024, samples.count)
    guard windowSize > 32 else {
      return silentFeatures()
    }

    let window = Array(samples.suffix(windowSize))
    let rms = sqrt(window.reduce(0.0) { $0 + $1 * $1 } / Double(window.count))
    let bins = makeFrequencyBins(window, binCount: 96)
    let bass = averageBand(bins, minFrequency: 20, maxFrequency: 250)
    let mid = averageBand(bins, minFrequency: 250, maxFrequency: 4_000)
    let treble = averageBand(bins, minFrequency: 4_000, maxFrequency: configuredSampleRate / 2)
    let centroid = spectralCentroid(bins)
    let rawPulse = max(0, bass - previousBass * 0.82) * 3.4
    let beatPulse = clamp(rawPulse + previousPulse * 0.72)

    previousBass = bass
    previousPulse = beatPulse

    return AudioFeatures(
      rms: clamp(rms * 1.5),
      bass: bass,
      mid: mid,
      treble: treble,
      centroid: centroid,
      beatPulse: beatPulse,
      frequencyBins: bins,
      waveform: downsample(window, count: 128),
      isSilent: rms < 0.008 && bass < 0.012 && mid < 0.012
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

  private func downsample(_ values: [Double], count: Int) -> [Double] {
    guard !values.isEmpty else {
      return []
    }

    return (0..<count).map { index in
      let sourceIndex = Int(Double(index) / Double(max(1, count - 1)) * Double(values.count - 1))
      return clamp(values[sourceIndex], min: -1, max: 1)
    }
  }

  private func silentFeatures() -> AudioFeatures {
    AudioFeatures(
      rms: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      centroid: 0,
      beatPulse: 0,
      frequencyBins: Array(repeating: 0, count: 96),
      waveform: Array(repeating: 0, count: 128),
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
