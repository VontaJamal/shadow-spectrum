// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "SystemAudioHelper",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .executable(name: "SystemAudioHelper", targets: ["SystemAudioHelper"])
  ],
  targets: [
    .executableTarget(
      name: "SystemAudioHelper",
      swiftSettings: [
        .unsafeFlags(["-parse-as-library"])
      ]
    )
  ]
)

