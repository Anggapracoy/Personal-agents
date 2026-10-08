# Security reporting

Once private vulnerability reporting is enabled for the public repository, report suspected vulnerabilities through [GitHub's vulnerability reporting form](https://github.com/mg272011/Dash-opensource/security/advisories/new). If the form is unavailable, request a private reporting channel from the maintainer without disclosing the vulnerability in an issue. Do not put credentials, personal conversations, reproducible account-takeover details, or other sensitive evidence in public issues.

Include the affected commit, installation type, minimal reproduction using synthetic accounts, observed impact, and any suggested mitigation. Remove real tokens and personal information from logs and screenshots. Test only installations and accounts you control or have permission to test.

This project currently supports the latest source revision. There is no guaranteed response time or commercial security support. Maintainers should keep private vulnerability reporting enabled when making the repository public and coordinate fixes before publishing exploit details.

Self-hosting operators are responsible for HTTPS, trusted proxy configuration, database access, provider credentials, provider spending limits, backups, updates, and running background cleanup. See [installation configuration](docs/INSTALLATION_CONFIG.md). A passing dependency scan does not establish that an installation is secure.
