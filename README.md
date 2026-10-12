This project was submitted to the ryze.ai hackathon by Mike Sewell.

# Offline Lookout

An on-device scam-text detector. Paste a suspicious SMS or chat message and get
a verdict, a calibrated probability, the words that drove the decision, and a
plain-language tip on what to do next. Everything runs in your browser; nothing
is ever sent to a server.

**Ryze AI Hack: Small Models submission.** Model: fine-tuned
`microsoft/MiniLM-L12-H384-uncased` (33M parameters), exported to int8 ONNX and
run locally in the browser with transformers.js / onnxruntime-web. Zero remote
AI inference.

Full documentation, evaluation results, and licenses follow below as the build
progresses. See `LICENSE` (MIT) for the code license.
