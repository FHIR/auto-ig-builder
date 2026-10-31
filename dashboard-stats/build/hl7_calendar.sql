-- HL7 calendar used for the overlay. Hand-curated and approximate: edit here when HL7 publishes new dates.
-- confidence: high = HL7 event page; medium = secondary announcement; low = inferred (e.g. from ballot-package bursts).
create or replace table hl7_calendar as select * from (values
  ('wgm', 'Sep 2025 WGM+Plenary+Connectathon (Pittsburgh)', date '2025-09-13', date '2025-09-19', 'high', 'https://info.hl7.org/sept-2025-wgm'),
  ('ballot', 'Jan 2026 ballot open..close', date '2025-12-19', date '2026-01-19', 'medium', 'HL7 Canada InfoCentral post (6832)'),
  ('connectathon', 'Jan 2026 virtual FHIR Connectathon', date '2026-01-13', date '2026-01-15', 'medium', 'HL7 UK events / HL7 Canada forum'),
  ('wgm', 'Jan 2026 virtual WGM', date '2026-01-26', date '2026-01-30', 'medium', 'HL7 UK events / HL7 Canada forum'),
  ('ballot', 'May 2026 ballot (approx; ballot-pkg publication burst)', date '2026-04-07', date '2026-05-07', 'low', 'packages2 ballot-version dates'),
  ('wgm', 'May 2026 WGM+Connectathon (Rotterdam)', date '2026-05-16', date '2026-05-22', 'high', 'https://info.hl7.org/may-2026-wgm'),
  ('ballot', 'Sep 2026 ballot (approx; ballot-pkg publication burst)', date '2026-08-13', date '2026-09-13', 'low', 'packages2 ballot-version dates'),
  ('wgm', 'Sep 2026 Plenary+WGM+Connectathon (Rockville)', date '2026-09-19', date '2026-09-25', 'low', 'HL7 UK events calendar (single source; end date assumed)')
) t(kind, label, "start", "end", confidence, source);
