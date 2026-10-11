# Contributing to ByeBlocked

ByeBlocked is maintained independently. Contributions are accepted through issues and pull requests.

By submitting a pull request, you are responsible for the correctness, completeness, testing, and maintenance impact of your contribution.

## Bug Reports

Open a [Bug Report](https://github.com/8ug8ird/ByeBlocked/issues/new?template=bug_report.yml).

Include, when applicable:

- ByeBlocked version
- BetterDiscord version
- Steps to reproduce the issue
- Expected and actual behavior
- Relevant errors from the DevTools console (`Ctrl+Shift+I`)

Incomplete reports may be difficult to investigate.

## Feature Requests

Open a [Feature Request](https://github.com/8ug8ird/ByeBlocked/issues/new?template=feature_request.yml).

Describe the proposed feature, the problem it addresses, and any relevant use cases.

For substantial changes, discuss the proposed approach before starting implementation.

## Code Contributions

Fork the repository, make the required changes, and open a pull request.

Pull requests should:

- Address a single change or a closely related set of changes.
- Clearly explain what changed, why it is needed, and how it works.
- Preserve existing behavior unless a change is explicitly intended.
- Avoid unrelated modifications, unnecessary refactoring, and unrelated formatting changes.
- Include all necessary implementation, cleanup, and documentation changes.
- Be ready for review rather than relying on the maintainer to complete the implementation or discover basic issues through repeated review cycles.

For larger changes, open an issue before submitting a pull request to discuss the proposed approach.

## Testing Requirements

Contributors are responsible for testing their changes before requesting review.

For pull requests that change plugin behavior:

- Test the final version of the code in a real Discord desktop client with BetterDiscord and ByeBlocked installed whenever the change depends on Discord behavior, UI, or internal APIs.
- Verify both enabled and disabled states for changed settings, including whether previously hidden elements are restored when a setting is disabled.
- Check relevant existing behavior for regressions, especially in areas affected by the change.
- Check the DevTools console for errors, repeated patching, recovery loops, and other unexpected behavior.
- Retest after addressing review feedback. Previous test results do not automatically validate subsequent changes.

Include a test plan in the pull request description. List the relevant scenarios, steps performed, results, and any remaining limitations. Attach screenshots, recordings, or console output when they help demonstrate the results.

Only mark a test as completed if it was actually performed. If a scenario could not be tested, state that clearly and explain why.

Testing claims and supporting evidence must correspond to the commit being reviewed. Static analysis, code inspection, and successful builds are useful, but they do not replace runtime testing when runtime behavior is involved.

Pull requests with incomplete testing or unresolved functional issues may be returned for further work before review continues.

## AI-Assisted Contributions

AI coding tools are permitted, but their output must be reviewed, understood, and verified before submission.

If AI tools generate or substantially modify code, disclose this in the pull request description and briefly identify the affected areas. Ordinary autocomplete and minor writing assistance do not need to be disclosed.

Regardless of whether AI tools were used, the contributor is responsible for every line submitted, including its correctness, compatibility, security, and maintenance implications.

Contributors using AI tools are expected to:

- Understand the submitted code and be able to explain the reasoning behind its implementation.
- Review the complete diff instead of relying on AI-generated explanations or summaries.
- Verify API names, properties, event behavior, and other assumptions against reliable documentation or actual client behavior.
- Check for dead settings, unused code, incorrect conditions, unintended side effects, and regressions.
- Run appropriate tests and report the actual results without presenting assumptions or generated output as evidence of successful testing.
- Address review feedback by correcting the underlying issues, not merely by making superficial changes that satisfy individual comments.

AI-generated code is held to the same standards as any other contribution. Using AI does not reduce the contributor's responsibility for testing or debugging their submission.

## Code Style

Follow the existing code style, structure, and conventions used by the plugin.

Changes that introduce unnecessary restructuring, unrelated formatting changes, or inconsistent patterns may be rejected.

Prefer small, understandable changes that preserve established behavior and can be maintained as Discord and BetterDiscord evolve.

## Review Process

The maintainer may request changes, ask for additional tests, or close a pull request that is incomplete, insufficiently tested, outside the project's scope, or unsuitable for maintenance.

Review is intended to evaluate a contribution, not to replace the contributor's implementation, debugging, or testing work.

Please submit work that you have reviewed and tested to the best of your ability. Clear communication about limitations is preferable to claiming that unverified behavior works.
