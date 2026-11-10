# Performance testing

Based on the ISTQB Certified Tester Foundation Level Performance Testing syllabus. Use this file when a task mentions response time, throughput, load, number of users, capacity, stability over time or resource use.

## Principles

- Performance testing is iterative. Each run gives information that is used to tune the system, and the next run shows the effect, until the objectives are met.
- It follows the same seven activities as any other testing. See test-process.md.
- Results are only meaningful against stated objectives, for example a service level agreement or a requirement such as "95% of searches answer within 800 ms at 200 concurrent users".
- The test environment must be comparable to production in size and configuration, or the difference must be stated next to every result.

## Types of performance tests

| Type | Question |
| --- | --- |
| Performance test | How fast and efficient is the system under expected conditions? |
| Load test | Does it meet its targets under the expected and peak load? |
| Stress test | How does it behave above the expected load or with fewer resources, and does it recover? |
| Scalability test | Does performance grow as expected when resources or load grow? |
| Spike test | Does it handle a sudden burst and return to normal? |
| Endurance test | Does it stay stable over a long period, without leaks or slow degradation? |
| Concurrency test | What happens when many users do the same thing at the same moment? |
| Capacity test | How many users or transactions can it take before targets are missed? |

Static testing also applies: review the requirements, the architecture and the database design for performance risks before any load is generated.

## Metrics

- Response time per transaction, reported as average, percentiles (p90, p95, p99) and maximum.
- Throughput: transactions or requests per second.
- Error rate under load.
- Resource use: processor, memory, disk, network, connection pools and thread pools.
- Concurrency: number of active users or sessions.

Aggregate results over a stated period and always report the percentile together with the load at which it was measured.

## Process

### Planning

- Define the objectives and the acceptance criteria in numbers.
- Agree on the environment, test data, tools and people, and on what is out of scope.
- Identify performance risks for the architecture, for example a single database, synchronous calls between services or external dependencies.

### Monitoring and control

- Define control measures for problems such as a load generator that cannot produce the planned load, changed hardware or network and changed software.
- Evaluate the objectives to decide whether the exit criteria are met.

### Analysis

- Analyse requirements, objectives, service level agreements, the architecture and the business processes.
- Identify test conditions: load levels, time conditions and the transactions to test.
- Choose the types of test that answer the questions.

### Design

- Build an operational profile: which user groups exist, which transactions each performs, how often and with which think time. Take it from production logs, analytics or interviews.
- Build load profiles from the operational profile: ramp up, steady state and ramp down, the number of virtual users per group and the duration.
- Analyse throughput and concurrency: 500 users that each search once a minute produce 30 000 searches per hour; once an hour produces 500. The load is the rate, not the number of users.
- Design tests as modules that can be combined into larger scenarios.

### Implementation

- Arrange the cases into procedures that follow real user steps, including think time and realistic data.
- Prepare test data that matches production in volume and variety.
- Reset the environment to a known state before every run.

### Execution

- Generate the load, monitor the system and the load generator, and stop the run if the generator itself becomes the bottleneck.
- Record the exact build, configuration and data volume of every run.

### Analysis of results and completion

- Compare results with the objectives and explain each deviation with evidence from the metrics.
- Report the results to stakeholders in a short summary with charts where they help.
- Archive scripts, data and results so the next cycle can repeat the run.

## Typical failures and their causes

- Slow response at every load level: inefficient queries, missing indexes, too many calls between services.
- Slow response only at medium or high load: saturated resources, too small connection or thread pools, locking.
- Degradation over time: memory leaks, growing tables or logs, caches without eviction.
- Errors or timeouts at peak: limits on connections or rate limits, queue overflow.
- No recovery after a spike: resources that are not released, retries that amplify load.

## Limits of agent based checks

The agents in this application call the API one request at a time. They can measure single request response times, check timeouts, pagination limits and large payloads, and run small concurrency checks. A real load, stress or endurance test needs a load tool such as JMeter, Gatling, k6 or Locust. In that case the agent designs the operational and load profiles and the scripts, and reports the measurements it cannot take itself as open items.
