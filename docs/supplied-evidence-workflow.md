# Bounded supplied evidence and local critic coverage

For explicitly supplied public text that exceeds Studio's file limit, a coordinator
can package selected lines without downloading anything:

```powershell
python -m swarm.evidence supplied.txt docs/example-excerpt.json --source-url https://www.sec.gov/example --retrieved-at 2026-10-27 --context "Annual outlook table including headings and footnotes" --start 100 --end 140
```

Use only an explicitly supplied public-source text file. The command does not
fetch the URL, bypass source limits, parse original PDFs, or overwrite an existing
output. Input is capped at 10 MB; selected text is limited to 80 lines and the
serialized packet to 7,500 bytes. Choose a narrower range if it does not fit.
Include dated headings, units, fiscal period and nearby qualifications. Selection
is a coordinator judgment: the packager cannot prove omitted context is immaterial.

The packet records the exact supplied-text hash, excerpt hash, line coordinates,
total supplied lines and supplied source/context labels. Hashes are not hashes of
the original HTML/PDF unless the supplied text happens to be that exact encoding;
the packet always labels itself as supplied text, not an original document or a
worker retrieval. Availability, latest-prior verification and return eligibility
remain false. No metadata proves the source URL actually supplied the text.

Inspect and locally commit the packet under an allowed Studio path, then use the
normal idle snapshot-refresh procedure before an explicitly authorized mission.
All existing secret filters, snapshot limits and domain/download controls apply.
This is a coordinator CLI, not a new worker tool or an automatic ingestion route.

Local critics now receive explicit assigned Studio paths for their own bounded
preload. Before a local mission reaches `needs_review`, the controller records
`mission.review_read_coverage`: continuous complete reads for every explicitly
assigned path available in the pinned Studio snapshot. Reads must match the
critic's current task, path, snapshot commit and full-file hash. Peer reads,
earlier tasks, gaps and character-truncated chunks do not satisfy coverage.
Failure blocks the mission while preserving artifacts, without a retry.

This gate covers local missions and explicitly named available Studio files only;
it does not establish independent model reasoning, factual correctness, public
source completeness, or coverage of paths unavailable in Studio. Paid missions
are unchanged. Passing coverage still requires external coordinator review.
