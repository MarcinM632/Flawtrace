CREATE TABLE limit_rule (
    customer_id   VARCHAR(64) PRIMARY KEY,
    max_exposure  INT         NOT NULL,
    period_days   INT         NOT NULL DEFAULT 30,
    active        BOOLEAN     NOT NULL DEFAULT TRUE
);
