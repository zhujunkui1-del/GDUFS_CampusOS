import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// S0 does not need an R2 incremental cache or any cloud resources.
export default defineCloudflareConfig();
