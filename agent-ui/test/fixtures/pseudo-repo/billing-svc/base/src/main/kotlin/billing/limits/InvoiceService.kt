package billing.limits

import java.time.LocalDate

class InvoiceService {
    /** Invoice due date for a customer with an own rule. */
    fun dueDate(issued: LocalDate, rule: LimitRule): LocalDate = issued.plusDays(rule.periodDays.toLong())

    /** Invoice due date for a customer without a rule: the default period. */
    fun defaultDueDate(issued: LocalDate): LocalDate = issued.plusDays(LimitDefaults.PERIOD_DAYS.toLong())
}
