# Probe

A BetterDiscord plugin that checks whether ByeBlocked is still compatible with the current Discord version.

## What is it?

Probe is a diagnostic tool that is completely separate from ByeBlocked.

It inspects the internal parts of Discord that ByeBlocked depends on, such as Stores, internal modules, React components, and interface structures, to verify that they still exist and remain compatible.

Probe **does not modify Discord in any way.** It only inspects and reports.

## Why does it exist?

Discord is updated frequently, and sometimes these updates change internal structures that users never see, but the plugin relies on.

When that happens, one or more ByeBlocked features may stop working without any obvious error.

Probe was created to answer two simple questions:

- **Was this caused by a Discord update or is it a ByeBlocked bug?**
- **Which specific compatibility points are no longer working?**

Instead of manually investigating the problem or relying on vague reports like *"it stopped hiding messages"*, running a compatibility check immediately shows what failed and what most likely caused it.
