# Test process

Based on the ISTQB Foundation Level syllabus, section 1.4, and the ISTQB Performance Testing syllabus, section 3.1. Every task goes through the same seven activities. The Test Flow phases of this application map to them one to one.

| Activity | Test Flow phase | Question it answers | Output |
| --- | --- | --- | --- |
| Test planning | 1 Planning | What is tested, why, with which risks and when is it done? | Risks, priority, entry and exit criteria, verdict |
| Monitoring and control | 2 Monitoring | Is testing on track against the plan? | Progress metrics and corrective actions |
| Test analysis | 3 Analysis | What exactly must be tested? | Test strategy, test conditions with priority, coverage gap, impact of the change |
| Test design | 4 Design | How is each condition tested? | Test cases with inputs, steps and expected results |
| Test implementation | 5 Implementation | In which order and with what data and setup? | One executable procedure with priorities, time estimate and traceability |
| Test execution | 6 Execution | Does the system behave as expected? | Results for every step with evidence, defects |
| Test completion | 7 Completion | What did we learn and what is left? | Short explanation of how the feature works, known defects, archived testware |

## Inputs every phase uses

1. The task: the ticket with its description, acceptance criteria, subtasks and every comment, or the text the tester typed.
2. The knowledge base: this folder, starting with how-we-test.md.
3. Confluence pages that specify the feature.
4. The code of the affected repositories: what exists, what changed and what the validation rules really are.
5. The API contracts of the test environment.
6. The output of the previous phase.

When a source is missing the phase still runs on the sources that exist and lists what could not be confirmed.

## Phase rules

### 1 Planning

- Check the assumptions of the task against the code before anything else: named fields and functions exist, the change does not contradict existing validation and it is technically possible.
- List product risks and project risks separately, each with likelihood, impact and source.
- Entry and exit criteria must be concrete and checkable.

### 3 Analysis

- Choose one test strategy, at most two combined, and say why it fits this task.
- Identify the test conditions: functions, rules, data, states and interfaces affected by the change.
- Find where else the changed component or contract is used. Every confirmed use is in scope.
- Compare with existing automated tests and name what will not be covered.

### 4 Design

- Start from business cases: how a user really uses the feature and what must be true afterwards.
- Apply techniques inside those cases: equivalence partitions, boundary values, decision tables, state transitions.
- Every check has an action, an expected result calculated from the specification and a source.

### 5 Implementation

- Merge all designed checks into one procedure without losing any of them.
- Shared setup runs once. Each step names the endpoint, the data and the expected result.
- Prioritise by risk and estimate the time.

### 6 Execution

- Run the procedure on the test environment through the API of the system.
- Record every call. A result is only a result when it cites the call that produced it.
- Compare actual with expected. A difference is a defect or an open question, never ignored.
- Confirm a defect with a retest before reporting it.

### 7 Completion

- Explain in plain words how the feature works and why, with one example.
- List known defects of the area and what remains open.
