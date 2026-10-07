import { z } from 'zod';

// Zod 4 probes once with `new Function` to see if it may compile faster
// validators. Our CSP forbids eval, so the probe was reported as a policy
// violation on every page (Lighthouse "Best practices"). Jitless skips it;
// the server keeps the compiled validators. Imported first by the modules that parse.
z.config({ jitless: true });
