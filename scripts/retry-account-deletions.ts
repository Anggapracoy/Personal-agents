import { retryAccountDeletions } from '../lib/account-deletion-cleanup';
import { securityDatabase } from '../lib/security-store';
try { console.log(await retryAccountDeletions()); }
finally { await securityDatabase()?.end({ timeout: 5 }); }
