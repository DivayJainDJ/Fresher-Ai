# Job description match evaluation set

`cases.json` contains 20 small synthetic resume/job-post pairs with human-assigned coarse relevance labels (`low`, `medium`, `high`). The labels are intended for later measurement, not as training data. Keep the label rubric stable when adding model evaluation:

- **high**: strong overlap on the role's core requirements.
- **medium**: transferable or partial overlap, with important gaps.
- **low**: little evidence for the role's core requirements.

The recorded set size is **20 pairs**. Match accuracy is not yet measured; it should be recorded after the matcher score thresholds are defined and evaluated against these labels.
