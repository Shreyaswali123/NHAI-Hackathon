# Sentinel Guard

Offline biometric authentication for NHAI field personnel, built for the Datalake 3.0 attendance workflow.

Sentinel Guard is a React Native mobile app/module that verifies a person on-device using face enrollment, blink-and-smile liveness checks, MobileFaceNet embeddings, offline storage, and background sync when connectivity returns. It is designed for highway project sites where field teams may need to authenticate without an active internet connection.

## Problem Statement

Datalake 3.0 field attendance and inspection workflows depend on reliable identity verification, but many highway zones have poor or zero internet coverage. Cloud-based biometric systems fail in those conditions, and simple photo-based verification is vulnerable to spoofing.

Sentinel Guard addresses this gap with:

- Offline face enrollment and authentication.
- On-device liveness detection using blink and smile challenges.
- MobileFaceNet TFLite inference on a mid-range Android device.
- Local transaction logging with automatic sync-and-purge on reconnect.
- A native Android RGB cropper that prepares real face pixels for model input.

## Key Features

- **Offline-first authentication:** Authentication runs fully on-device after enrollment.
- **Multi-person enrollment:** Stores multiple named personnel embeddings in local storage.
- **Liveness challenge:** Requires blink first, then smile, with a 10-second timeout per step.
- **Face matching:** Compares live embeddings against enrolled embeddings using cosine distance.
- **Native image preprocessing:** Kotlin module decodes, crops, resizes, and extracts raw RGB pixels.
- **Local ledger:** Saves verified and rejected scan records while offline.
- **Background sync:** Uses NetInfo to upload pending records once connectivity is restored.
- **Datalake-ready services:** Core services are isolated so they can be copied into an existing React Native app.

## Tech Stack

| Area | Technology |
| --- | --- |
| App framework | React Native 0.85 |
| Language | TypeScript, Kotlin |
| Camera | react-native-vision-camera |
| Face detection | @react-native-ml-kit/face-detection |
| ML model | MobileFaceNet TFLite, 128-d embeddings |
| TFLite runtime | react-native-fast-tflite |
| Storage | @react-native-async-storage/async-storage |
| Network monitoring | @react-native-community/netinfo |
| Navigation | @react-navigation/stack |
| Native module | SentinelImageCropperModule.kt |

## App Flow

1. **Enroll personnel**
   - Admin enters a personnel name.
   - Front camera captures a face image.
   - MLKit detects the face bounds.
   - Native Kotlin crops the face, resizes it to 112 x 112, and writes raw RGB bytes.
   - MobileFaceNet generates a 128-dimensional embedding.
   - The embedding is stored locally with the name and timestamp.

2. **Run liveness**
   - The app starts with a blink challenge.
   - Both eye-open probabilities must drop below 25%.
   - The app then starts a smile challenge.
   - Smile probability must exceed 75%.
   - Each challenge has a 10-second timeout.

3. **Authenticate face**
   - The app captures a fresh auth frame after liveness passes.
   - The native cropper prepares raw RGB input.
   - MobileFaceNet generates a live embedding.
   - The app compares it with all enrolled embeddings.
   - A match is accepted when cosine distance is below `0.18`.

4. **Record result**
   - Successful scans are saved as `VERIFIED_OFFLINE`.
   - Failed scans are saved as `REJECTED_OFFLINE`.
   - The result screen shows identity, confidence, timestamp, mode, and model details.

5. **Sync later**
   - Pending records remain in AsyncStorage while offline.
   - When connectivity returns, the app posts the ledger to the configured endpoint.
   - On a successful response, the local ledger is purged.

## Architecture

```text
Front Camera
    |
    v
VisionCamera photo capture
    |
    v
MLKit face detection and liveness probabilities
    |
    v
SentinelImageCropperModule.kt
BitmapFactory decode -> face crop -> 112 x 112 resize -> raw RGB bytes
    |
    v
MobileFaceNet TFLite inference
    |
    v
128-d embedding
    |
    v
Cosine distance match against AsyncStorage enrollments
    |
    v
Result screen and offline ledger record
```

## Project Structure

```text
.
|-- App.tsx
|-- src
|   |-- database
|   |   `-- OfflineDatabase.ts
|   |-- models
|   |   `-- mobilefacenet.tflite
|   |-- navigation
|   |   `-- AppNavigator.tsx
|   |-- screens
|   |   |-- RegisterScreen.tsx
|   |   |-- ScanningScreen.tsx
|   |   `-- ResultScreen.tsx
|   `-- services
|       |-- AWSBackgroundSync.ts
|       |-- FaceRecognitionService.ts
|       `-- LivenessMath.ts
`-- android
    `-- app/src/main
        |-- assets/mobilefacenet.tflite
        `-- java/com/awesomeproject
            |-- SentinelImageCropperModule.kt
            `-- SentinelImageCropperPackage.kt
```

## Core Files

- `src/screens/RegisterScreen.tsx` handles name entry, camera capture, face enrollment, and enrollment deletion.
- `src/screens/ScanningScreen.tsx` handles blink/smile liveness, face matching, offline record creation, and sync monitoring.
- `src/screens/ResultScreen.tsx` displays authentication success or failure details.
- `src/services/FaceRecognitionService.ts` loads the TFLite model, prepares input, runs inference, and computes distances.
- `src/services/LivenessMath.ts` defines blink and smile thresholds.
- `src/database/OfflineDatabase.ts` stores enrollments and scan records in AsyncStorage.
- `src/services/AWSBackgroundSync.ts` uploads pending records after network restoration.
- `android/app/src/main/java/com/awesomeproject/SentinelImageCropperModule.kt` performs native face crop and RGB extraction.

## Data Model

### EnrolledFace

```ts
{
  userId: string;
  embedding: number[];
  enrolledAt: string;
}
```

### ScanRecord

```ts
{
  id: string;
  timestamp: string;
  status: string;
  vectorId: string;
}
```

## Setup

### Prerequisites

- Node.js `>= 22.11.0`
- Android Studio with Android SDK
- JDK compatible with the installed React Native toolchain
- A physical Android device with a front camera is recommended

### Install dependencies

```sh
npm install
```

### Start Metro

```sh
npm start
```

### Run on Android

In another terminal:

```sh
npm run android
```

## Android Notes

The custom native cropper is registered manually in `MainApplication.kt`:

```kt
add(SentinelImageCropperPackage())
```

The TFLite model is bundled at:

```text
android/app/src/main/assets/mobilefacenet.tflite
```

Metro is configured to bundle `.tflite` assets in `metro.config.js`.

## Configuration

### Match threshold

The face match threshold is defined in:

```ts
FaceRecognitionService.MATCH_THRESHOLD = 0.18
```

Lower values are stricter. Higher values are more permissive.

### Liveness thresholds

The liveness thresholds are defined in `src/services/LivenessMath.ts`:

```ts
BLINK_THRESHOLD = 0.25
SMILE_THRESHOLD = 0.75
```

### Sync endpoint

The current demo endpoint is:

```ts
https://httpbin.org/post
```

Replace `AWS_ENDPOINT` in `src/services/AWSBackgroundSync.ts` with the production Datalake or AWS API endpoint before deployment.

## Datalake 3.0 Integration

Sentinel Guard is structured so the authentication layer can be moved into an existing Datalake React Native app with minimal changes.

1. Register `SentinelImageCropperPackage()` in `MainApplication.kt`.
2. Copy these services into the Datalake app:
   - `src/services/FaceRecognitionService.ts`
   - `src/services/AWSBackgroundSync.ts`
   - `src/database/OfflineDatabase.ts`
3. Copy `mobilefacenet.tflite` to `android/app/src/main/assets`.
4. Add `.tflite` to Metro asset extensions.
5. Call the flow from the attendance screen:
   - `FaceRecognitionService.initModel()`
   - liveness challenge
   - `FaceRecognitionService.buildRealEmbedding(...)`
   - cosine-distance matching
   - offline record save

Existing Datalake screens, API integrations, and workflows can remain unchanged while the attendance capture step is replaced with offline biometric verification.

## Current Status

- Android implementation is functional.
- Offline enrollment and authentication are implemented.
- Blink and smile liveness are implemented through MLKit probabilities.
- Sync-and-purge is implemented with a demo HTTP endpoint.
- iOS support is planned; the JavaScript code is React Native compatible, but the native cropper currently exists for Android.

## Known Limitations

- The sync endpoint is a demo stub and must be replaced for production.
- Stored embeddings and records currently use AsyncStorage and should be encrypted for production.
- iOS requires an equivalent native cropper implementation.
- Thresholds may need calibration across different devices, lighting conditions, and user populations.

## Hackathon Context

This project was built for NHAI Hackathon 7.0 as an offline biometric authentication module for Datalake 3.0. The reference deck highlights the target constraints:

- Model size around 4.5 MB.
- Sub-second local inference target.
- Mid-range Android device compatibility.
- Zero-network authentication.
- On-device liveness to reduce photo and replay spoofing.
- Sync to cloud infrastructure only after connectivity returns.
