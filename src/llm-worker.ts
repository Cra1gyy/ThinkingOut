// Runs the on-phone model off the main thread so the app stays responsive
// while a note is being sorted. See local-ai.ts.
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
