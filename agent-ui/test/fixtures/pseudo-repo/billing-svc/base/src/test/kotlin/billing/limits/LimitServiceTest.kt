package billing.limits

class LimitServiceTest {
    fun exposureAboveLimitIsRejected() {
        val service = LimitService(FakeRepo(LimitRule("c1", maxExposure = 100)), NoEvents())
        check(!service.check("c1", 101).allowed)
    }

    fun exposureAtLimitIsAllowed() {
        val service = LimitService(FakeRepo(LimitRule("c1", maxExposure = 100)), NoEvents())
        check(service.check("c1", 100).allowed)
    }
}

class FakeRepo(private val rule: LimitRule) : LimitRuleRepository {
    override fun find(customerId: String) = rule
    override fun save(rule: LimitRule) {}
}

class NoEvents : EventPublisher {
    override fun publish(topic: String, payload: Map<String, Any?>) {}
}
