# Test techniques

Short reference for choosing test cases. The Reference pages of the application explain each technique in more detail.

| Technique | Use it when | Coverage item |
| --- | --- | --- |
| Equivalence partitioning | An input or output has groups of values treated the same way | Each valid and invalid partition |
| Boundary value analysis | Partitions are ordered, such as numbers, dates or lengths | Each boundary and its neighbour |
| Decision table | The result depends on a combination of conditions | Each feasible column of the table |
| State transition | The object has a life cycle | Each valid transition, and invalid transitions attempted |
| Use case | A user flow has a main path and alternatives | Main path, each alternative and each error path |
| Pairwise | Many parameters with several values each | Each pair of values |
| Error guessing | The area has a history of defects | Each known defect class |
| Exploratory testing | The specification is thin or the risk is unclear | Each charter, time boxed |

Rules:

- A negative check breaks exactly one rule and keeps all others valid, otherwise it does not prove which rule rejected the input.
- An expected result comes from the specification or the code, never from running the system and copying what it returned.
- A check that cannot be run on the test environment is listed as an open question with the reason.
