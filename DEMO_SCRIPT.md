# Demo video script (target: under 2 minutes)

Record on a phone (Android preferred, so the Share flow shows) or in a desktop
browser with DevTools device mode. No music. Every number, link and brand in the
sample messages is fictional.

## Setup before recording

1. Open the deployed PWA once while online so the service worker caches the
   app, the ONNX model and the wasm runtime. The first-load ring shows the real
   bytes arriving and ends on `Ready · works offline`; the header badge then
   reads `0 requests · offline-ready` on a phone (`0 network requests since
   ready · online · cached` at desktop width).
2. Install it to the home screen (Android: "Add to Home screen").
3. Close the app. Turn on **airplane mode**. Confirm the status bar shows it.
4. Have the three sample texts ready in a notes app or the Messages app:
   - Parcel: `PostLink: your parcel could not be delivered due to an unpaid customs fee of $2.99. Pay now to avoid return: https://postlink-redeliver.example/p/48213`
   - OTP: `Your verification code is 482913. It expires in 10 minutes. Do not share this code with anyone.`
   - Hi mum: `Hi mum, I dropped my phone in the sink and this is my new number. Can you save it and message me back? x`

## Shot list

| # | Time | Shot | What to say (voice-over or caption) |
|---|------|------|-------------------------------------|
| 1 | 0:00-0:08 | Status bar with airplane mode on, then open Offline Lookout from the home screen. | "Airplane mode is on. Offline Lookout is a scam-text detector that runs entirely on the phone." |
| 2 | 0:08-0:20 | Badge in the header: `0 requests · offline-ready`. | "The model is a 33-million-parameter MiniLM, fine-tuned and quantised to 33 MB of int8 ONNX. It never calls a server." |
| 3 | 0:20-0:45 | Select the parcel-fee text in Messages, tap Share, choose Lookout (or paste it). The message is scanned, the highlights sweep in, the strip fills and the number counts up, then the red LIKELY A SCAM lands (around 97%). | "A fake parcel-fee text. Red, 97% scam. The highlighted words are an on-device occlusion test: remove 'fee', 'pay now', the link, and the score drops. The chips are plain rules: link, lookalike domain, money, urgency." |
| 4 | 0:45-0:58 | Read the "What to do" tips. | "It tells you what to do: don't pay, check the courier's official app." |
| 5 | 0:58-1:12 | Paste the OTP text. Card turns green. | "A real one-time passcode: green. Codes and numbers alone don't trigger it. That false-positive rate is measured on a hard-negative set." |
| 6 | 1:12-1:30 | Paste the "hi mum" text. Card turns red; scam type reads Impersonation. | "'Hi mum, new number.' No link, no money, still red: impersonation. The advice: call the old number." |
| 7 | 1:30-1:40 | Point at the badge again: still `0 network requests`. Toggle the batch section briefly (optional). | "Still zero network requests. Everything you paste stays on the device." |
| 8 | 1:40-1:55 | Cut to the README: model specs line and the evaluation table (F1 / ROC-AUC / hard-negative FPR / latency / size). | "On the held-out modern test set it scores [F1 from README], with [p50] millisecond inference on a phone CPU." |
| 9 | 1:55-2:00 | Title card: "Offline Lookout. Ryze AI Hack: Small Models. github.com/maikunari/offline-lookout". | — |

## Notes

- If the Share sheet doesn't list Lookout, the PWA wasn't installed from the
  deployed origin; fall back to copy-paste. The shot still works.
- The app is dark only; the phone's light/dark setting does not change it.
- Fill in the bracketed numbers in shot 8 from the eval table in `README.md`.
