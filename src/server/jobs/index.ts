/** Jobs and configurations (#46 slice 5), for the `/api/v1/jobs*` Route Handlers. */
export { createJob, getJobSnapshot, type JobsDeps, patchJob, saveConfiguration } from "./jobs";
export { type JobCreatedHook, onJobCreated } from "./hooks";
export { verifyConfiguration } from "./verify";

// Every new job queues its server-side sweep (#46 slice 7, docs/QUEUE.md).
import "../queue/register";
