# Security Policy

## Supported versions

Only the latest minor release line receives security fixes. v0.2.x is the
current line.

| Version | Supported |
|---------|-----------|
| 0.2.x   | yes       |
| 0.1.x   | no        |
| < 0.1   | no        |

## Reporting a vulnerability

Please do **not** file public GitHub issues for security reports.

Email [ankitvirdi4@gmail.com](mailto:ankitvirdi4@gmail.com) with:

- A description of the issue
- Steps to reproduce or a proof of concept
- The version affected
- Any relevant logs (with secrets redacted)

You can expect:

- An acknowledgement within 72 hours
- An initial assessment within 7 days
- A coordinated disclosure timeline once a fix is prepared

## Scope

In scope:
- The `react-native-llm-meter` package on npm
- Code in this repository
- Dependencies bundled into the published artifact

Out of scope:
- Provider SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`)
- React Native, Expo, AsyncStorage, expo-sqlite (report upstream)
- Issues in user code that pass secrets through the meter
