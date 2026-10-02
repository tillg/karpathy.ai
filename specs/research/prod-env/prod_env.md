---
title: "Prod Env"
order: 1
created: 2026-09-28
edited: 2026-09-28
---

# Prod Env

Note: This is a research project only, we don't build it yet!!! 

Core question: What is our Prod environment? We want a hoster that has a significant free tier.

About the trivial ones:
- AWS is ruled out because I already used up my free tier
- Same for Azure

I love to use Github for anything that is static, but I guess it doesn't work here since we need a running server.

Pls look at all kind of hosters, big, small, American, German / European...

Make sure those are in your list, as friends have mentioned them to me:
- IONOS
- Hetzner

Aspects that are critical in thinking PROD besides the hoster are
- Security: The hosted server will clone our user's .md files vaults - how do we keep that safe?
- For the time being we stay single-user only. We could also work with a solution where we locally need to install a token or something clumsy like that, if it really improves security
- Disk space: Having many .md vaults on the server might result in lots of data on the server. We should monitor and eventually limnit it. Probably the right trigger wouzld be before adding an additional vault.
