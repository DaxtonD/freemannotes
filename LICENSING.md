# Licensing

Freeman Notes is free software under the **GNU Affero General Public License v3.0 only**
(`AGPL-3.0-only`). The full, binding text is in [LICENSE](LICENSE). This page is the plain-English
companion — it is not the licence and it is not legal advice.

---

## If you self-host Freeman Notes

**Running it, unmodified, asks nothing of you.** Install it, run it for yourself, your family, your
team or your company, commercially or not, on as many machines as you like. Don't remove the
copyright and licence notices. That's the whole deal.

**If you modify it and let other people use it over a network**, the AGPL asks one thing: offer
those users the source of *your* modified version, under the AGPL. That's section 13, and it is the
only part of this licence that surprises people. It exists so that improvements made to software
that was given away freely come back to everybody, instead of disappearing into someone's product.

**If you give copies to other people** — a fork, a repackaged image, a modified build — it travels
under the AGPL too, with the source available.

A few things worth being explicit about, because people ask:

- **Your notes are yours.** The licence covers the software, not a single byte of anything you write
  in it. Nothing in the AGPL gives anyone any claim over your content.
- **Internal company use is fine.** Deploying this for your own organisation is not "distribution",
  and an unmodified deployment triggers nothing at all.
- **Private patches are fine.** Modify it all you like. The obligation only attaches when other
  people use your modified version.
- **We don't phone home.** No telemetry, no analytics, no licence check. The only outbound requests
  your server makes are the ones you configure: your database, optional Redis, optional Gotenberg,
  push notifications if you turn them on, and fetching link previews for URLs your users paste.

---

## What this licence guarantees you, permanently

**Every version of Freeman Notes published under the AGPL stays under the AGPL, forever.** That
cannot be taken back — not by the author, not by a future owner, not by anyone who acquires the
project.

This matters, so here it is without hedging: if this project is ever sold, or abandoned, or if its
direction changes in a way you hate, the last AGPL release is yours. You can fork it, continue it,
and build on it. You are not dependent on anyone's continued goodwill, including the author's. That
is the point of choosing a copyleft licence rather than making a promise.

---

## Commercial licensing

The AGPL's reciprocity requirements are a genuine problem for some organisations — a company that
wants to build a proprietary product on this codebase, embed it in something they ship, or offer a
modified version as a service without publishing their changes, cannot do that under the AGPL.

Because every copyright in Freeman Notes is held by one person, a licence on different terms can be
granted. If the AGPL doesn't work for what you're trying to do, get in touch rather than assuming
the answer is no: **https://github.com/DaxtonD/freemannotes** (open an issue, or use the contact
details in the repository).

This is also why contributors sign a [CLA](CLA.md) — it is what keeps that option available.

---

## Contributing

Contributions are very welcome. Before your first pull request merges you'll be asked to sign the
[Contributor Licence Agreement](CLA.md). A bot posts a one-time comment on your PR with a link; you
reply to sign, and it's recorded.

**You keep the copyright in your contribution.** The CLA is a licence grant, not an assignment —
you are not signing your work away. See [CLA.md](CLA.md) for exactly what it does and why it's
needed.

---

## Third-party components

Freeman Notes depends on a lot of other people's work — React, Yjs, Prisma, Excalidraw, pdf.js,
TipTap and many more — each under its own licence, and each retaining its own copyright. Their
terms govern their code, not this licence. `npm ci` will fetch them; their licences ship inside
`node_modules`, and the container image includes them too.

Optional external services you may choose to run alongside Freeman Notes (PostgreSQL, Redis,
Gotenberg) are separate programs under their own licences. Running them next to this one doesn't
combine them with it.

---

## A note on the previous licence

Freeman Notes 1.16.0 and earlier were published under a bespoke "Freeman Notes License 1.0" — a
source-available licence with a non-compete clause. It was well-intentioned but wrong in three
ways: it wasn't open source while being presented as though it were, its contributor IP clause
probably wasn't legally effective, and it contained a clause converting the project to the MIT
licence on a change of ownership, which would have made the project unsellable and, in the
meantime, gave users a weaker guarantee than they have now.

The AGPL replaces all of it and does the job properly: it is genuinely open source, it is a licence
companies and distributions already know how to evaluate, and it gives the self-hosted community a
structural guarantee instead of a promise.

Versions already published under the old licence keep whatever rights that licence granted their
recipients. Nothing here retroactively takes anything away from anyone.
