# Charts

A chart exists to make one comparison easy. Pick the form that shows it, and label it so nobody has to decode it. Rule ids are stable: lenses, checks and test names cite them.

**R-charts-1: No pie or donut charts. Use sorted bars.**
People compare lengths well and angles badly. A horizontal bar chart sorted by value shows share and rank at once. Add the percent as a label if share matters.
- Don't: a donut with six slices and a legend.

**R-charts-2: Chart colours come from the chart palette slots, kept apart from UI colours.**
Series use `chart-1` to `chart-4`, and `chart-other` for the rest. Never draw a series in a status colour (`critical`, `warning`, `success`) or the brand colour: a normal series then reads as an alert or a button. Use status colours only when the data is a status (failed vs passed), with a label. If a chart slot resolves to the same hue as a status slot, report it as a token problem.
- Don't: series 1 drawn in the same red as `text-critical`.

**R-charts-3: Bar axes start at zero.**
A bar's length is its value, so a cut axis makes a 2% change look like a doubling. A line chart may zoom its axis to show change, but its axis labels must make the range obvious.

**R-charts-4: Label directly instead of using a legend where you can.**
Put the series name at the end of its line, and the value at the end of each bar. Fall back to a legend only when labels would collide, and order the legend the same way as the data.

**R-charts-5: Sort categories by value, with "Other" last.**
Largest first, unless the categories have a natural order (time, age bands, funnel steps). Group the long tail into "Other", colour it `chart-other`, and put it last whatever its size.

**R-charts-6: Keep the series count small.**
At most four coloured series plus "Other". Beyond that, use small multiples or let the user pick which series to show.

**R-charts-7: Show the exact number on hover and in an accessible table.**
Hover and keyboard focus on a bar or point show its exact value, formatted with the shared formatter (R-locale-1). Every chart has a one-sentence summary and a data table that screen readers can reach (visually hidden, or behind a "Show as table" toggle).
- Do: `<figure>` with the chart, a `<figcaption>` summary, and a `<table>` of the same rows.

**R-charts-8: Empty and partial charts say so.**
No data: keep the frame and say why ("No sales in this period"), instead of blank axes or a flat line at zero that reads as real zeros (R-states-6). Missing data inside a range: break the line or shade the gap and add a note, never draw through it or plot it as 0. An unfinished current period is labelled ("Month to date") or drawn dashed.

**R-charts-9: Label units and the time range.**
Every axis that has units shows them ("Revenue, USD", "Minutes"). The chart title or subtitle names the period ("Last 30 days"). Tick labels go through the shared formatter, with no more decimals than the data supports.

**R-charts-10: Charts follow the same loading and error rules as everything else.**
Skeleton on first load only (R-states-1). On refetch, keep the old chart and mark it as updating. A failed chart shows its error and a retry in its own frame, so the rest of the dashboard still works (R-states-8).

**R-charts-11: Pick the form from the question.**
- Change over time: a line (or bars for a few periods).
- Compare categories: horizontal bars, sorted (R-charts-5).
- One number that matters: a stat with its comparison (R-states-7), not a chart.
- Distribution: a histogram, not a line through unordered buckets.

**R-charts-12: One value axis per chart.**
Two y-axes with different scales let the chart say anything you like. Split it into two charts that share the x-axis instead.

**R-charts-13: Keep the frame quiet so the data stands out.**
Gridlines and axes use `border-faint`, tick labels use `text-fg-muted` in the `text-caption` role, and there's no 3D, shadow or gradient fill. Light and dark mode both meet 3:1 for the marks (R-a11y-2).

## Before you ship a chart

- Sorted, starts at zero (bars), "Other" last, four series or fewer.
- Series colours from `chart-*` slots only, none matching a status colour.
- Direct labels or an ordered legend, units and period named.
- Exact values on hover and focus, plus a summary and a table.
- Empty, partial, loading and error states each render on purpose.
