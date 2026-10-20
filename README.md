# WebMirror — High-Fidelity Website Cloning System

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Android](https://img.shields.io/badge/Android-API%2026%2B-green.svg)](https://developer.android.com)
[![Node](https://img.shields.io/badge/Node.js-20%2B-brightgreen.svg)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/Playwright-Chromium-orange.svg)](https://playwright.dev)

WebMirror is a production-grade website reproduction and offline archiving platform. It pairs a native Android application built with Jetpack Compose & Material 3 with a persistent, containerized browser-processing backend powered by genuine Chromium and Playwright.

---

## 1. System Architecture

```text
┌────────────────────────────────────────────────────────┐
│           Android Control Client (Kotlin / M3)         │
│  - URL validation & depth configuration                │
│  - Live SSE progress streaming & terminal event log    │
│  - Interactive WebView clone preview                   │
│  - Automated Quality Assurance scorecard               │
│  - Direct ZIP archive download & system share intent   │
└───────────────────────────┬────────────────────────────┘
                            │ REST API + SSE
                            ▼
┌────────────────────────────────────────────────────────┐
│          Browser-Processing Engine (Node / TS)         │
│  ┌───────────────────────┐  ┌───────────────────────┐  │
│  │   Genuine Chromium    │  │   SSRF Security Guard │  │
│  │  (Playwright Worker)  │  │ (DNS & IP validation) │  │
│  └───────────┬───────────┘  └───────────┬───────────┘  │
│              ▼                          ▼              │
│  ┌──────────────────────────────────────────────────┐  │
│  │           High-Fidelity Pipeline                 │  │
│  │ 1. Connecting & SSRF Destination Verification    │  │
│  │ 2. Chromium Render & Lazy-Load Auto-Scroll       │  │
│  │ 3. Multi-Page Same-Origin Link Crawler           │  │
│  │ 4. Asset Extractor (CSS, JS, Fonts, Media, SVGs) │  │
│  │ 5. Relative Path Rewriter (HTML, CSS, Srcset)    │  │
│  │ 6. QA Validator (Pixel Diff & 404 Link Audit)    │  │
│  │ 7. Static Archive Packager (ZIP + Manifest)      │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## 2. Key Features

- **Genuine Chromium Automation**: Evaluates JavaScript, dynamic single-page applications (SPAs), web fonts, and CSS animations.
- **Controlled Auto-Scroll**: Progressively triggers `loading="lazy"`, responsive `<picture>`, and IntersectionObserver components.
- **Strict SSRF Guard**: Enforces protocol safety (`http:` / `https:`), resolves DNS before execution, and blocks loopback (`127.0.0.1`), private RFC1918 blocks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and cloud metadata (`169.254.169.254`).
- **Asset Portability & URL Rewriting**: Converts all hardcoded links, fonts, stylesheets, and responsive `srcset` descriptors to relative paths.
- **Automated Quality Assurance**:
  - Compares original and clone viewports using perceptual pixel difference (`pixelmatch`).
  - Audits all exported files for missing resources and broken internal links.
  - Outputs a weighted **Fidelity Score** (0–100%) and deployment readiness matrix.
- **Static Hosting Compatible**: Ready to deploy immediately to **Vercel**, **Netlify**, **Cloudflare Pages**, or **GitHub Pages**.

---

## 3. Directory Structure

```text
bright-tesla/
├── app/                              # Native Android Application (Kotlin)
│   ├── build.gradle                  # App build configuration & dependencies
│   ├── src/main/
│   │   ├── AndroidManifest.xml       # Manifest & FileProvider declarations
│   │   ├── java/com/webmirror/app/
│   │   │   ├── MainActivity.kt       # Primary UI, tabs, SSE listener, WebView
│   │   │   ├── data/                 # API client, models, preferences
│   │   │   └── ui/                   # Adapters, bottom sheet dialogs, theme
│   │   └── res/                      # Material 3 layouts, drawables, colors
├── backend/                          # Browser-Processing Service (TypeScript)
│   ├── src/
│   │   ├── server.ts                 # Express REST API & SSE streaming
│   │   ├── engine/
│   │   │   ├── browser.ts            # Chromium pipeline coordinator
│   │   │   ├── crawler.ts            # Multi-page crawler & link normalizer
│   │   │   ├── asset-extractor.ts    # Resource downloader & content deduplicator
│   │   │   ├── url-rewriter.ts       # Relative path transformer
│   │   │   ├── validator.ts          # Automated QA & pixel diff engine
│   │   │   └── packager.ts           # Manifest, report, README, and ZIP builder
│   │   ├── security/                 # SSRF guard & IP range verification
│   │   └── storage/                  # Persistent job state & workspace manager
│   ├── tests/                        # Automated unit & integration tests
│   ├── Dockerfile                    # Container definition with Chromium
│   └── package.json
├── docker-compose.yml                # Production multi-container orchestration
├── build.gradle                      # Root Android Gradle configuration
├── settings.gradle                   # Gradle plugin & module setup
└── .env.example                      # Example environment variables
```

---

## 4. Backend Deployment Instructions

### Option A: Running with Docker Compose (Recommended)

```bash
docker compose up -d --build
```
The service will start on `http://0.0.0.0:3000` with automated health checks.

### Option B: Running Locally with Node.js

```bash
cd backend
npm install
npm run build
npm start
```

### Environment Configuration

Copy `.env.example` to `.env`:
```env
PORT=3000
NODE_ENV=production
MAX_CRAWL_CONCURRENCY=4
JOB_TIMEOUT_MS=60000
RETENTION_HOURS=24
```

---

## 5. Android Build Instructions

### Prerequisites
- Android SDK (API 35, Build-Tools 35.0.0)
- Java 17
- Gradle 8.14.3

### First Build (Allow Dependency Resolution)
```bash
timeout 15m gradle -Dorg.gradle.jvmargs= --no-daemon --max-workers=2 \
  --init-script /root/.gradle/init.d/pocketdev-android.gradle \
  -Pandroid.aapt2FromMavenOverride=/root/android-sdk/build-tools/35.0.0/aapt2 \
  assembleDebug --console=plain --stacktrace
```

### Subsequent Fast-Path Builds (Cached Offline)
```bash
timeout 5m gradle -Dorg.gradle.jvmargs= --no-daemon --max-workers=2 --offline \
  --init-script /root/.gradle/init.d/pocketdev-android.gradle \
  -Pandroid.aapt2FromMavenOverride=/root/android-sdk/build-tools/35.0.0/aapt2 \
  assembleDebug --console=plain --stacktrace
```

The compiled APK will be generated at:
`app/build/outputs/apk/debug/app-debug.apk`

---

## 6. REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service health, uptime, and active jobs count |
| `GET` | `/api/jobs` | List recent cloning projects with summary stats |
| `POST` | `/api/jobs` | Submit new cloning job (`url`, `crawlDepth`, `viewport`) |
| `GET` | `/api/jobs/:id` | Retrieve full job state, metrics, and logs |
| `GET` | `/api/jobs/:id/events` | Server-Sent Events (SSE) real-time progress stream |
| `GET` | `/api/jobs/:id/preview/*` | Live static server preview of the cloned website |
| `GET` | `/api/jobs/:id/report` | Automated QA scorecard and broken link audit |
| `GET` | `/api/jobs/:id/download` | Download exported static project ZIP archive |
| `POST` | `/api/jobs/:id/cancel` | Cancel an in-progress crawling operation |
| `POST` | `/api/jobs/:id/retry` | Re-attempt extraction of failed or timed-out resources |
| `DELETE` | `/api/jobs/:id` | Purge job workspace from worker disk |

---

## 7. Authorized Usage Policy

WebMirror is designed for archiving, testing, and porting websites you own or are explicitly authorized to reproduce. 

- Do not bypass authentication mechanisms, login cookies, or paywalls.
- Do not attempt to defeat CAPTCHAs, bot detections, or rate limits.
- Respect source copyright, intellectual property licenses, and `robots.txt`.
- Built-in SSRF protection blocks scanning of internal networks and cloud metadata.
