//! Deterministic offline model. SplitMix64 is simulation-only randomness.
//!
//! Run with `--output <repository-root>` to write the report and its data.
//! `--quick` runs smaller volumes for checking the artifact generator.

use iroh_economics::{
    CONTRIBUTION, DENOMINATOR, Distribution, FEE, Health, MAX_REWARD, PRICE, REWARDS, TARGET, UNIT,
    distribution, health,
};
use serde::Serialize;
use std::{collections::BTreeSet, error::Error, fmt::Write as _, fs, path::Path};

#[derive(Clone, Copy)]
struct SplitMix64(u64);

impl SplitMix64 {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut value = self.0;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
        value ^ (value >> 31)
    }

    fn uniform(&mut self, bound: u64) -> u64 {
        // Rejection sampling removes modulo bias for every positive bound.
        let threshold = bound.wrapping_neg() % bound;
        loop {
            let value = self.next();
            if value >= threshold {
                return value % bound;
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
enum OutcomeMode {
    Random,
    Common,
    Legendary,
}

#[derive(Clone, Debug, Serialize)]
struct Scenario {
    name: String,
    seed: u64,
    attempts: u64,
    users: u64,
    initial_pool: u128,
    batch: u64,
    outcome: OutcomeMode,
    failure_percent: u64,
    retry_failures: bool,
}

fn scenario(name: &str, seed: u64, attempts: u64, initial_usdi: u128) -> Scenario {
    Scenario {
        name: name.into(),
        seed,
        attempts,
        users: 1_000,
        initial_pool: initial_usdi * UNIT,
        batch: 1,
        outcome: OutcomeMode::Random,
        failure_percent: 0,
        retry_failures: true,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    AwaitingDraw,
    Claimable,
    Paying,
}

struct Opening {
    user: u64,
    odds: Distribution,
    reward: Option<u128>,
    state: State,
    attempt: u64,
}

struct Ledger {
    initial_pool: u128,
    pool: u128,
    liabilities: u128,
    pending_fees: u128,
    vested_fees: u128,
    cash: u128,
    in_flight: u128,
    accepted: u64,
    completed: u64,
    paid_rewards: u128,
    drawn_rewards: u128,
    failures: u64,
    checks: u64,
    minimum_pool: u128,
    maximum_pool: u128,
    health_transitions: u64,
    last_health: Health,
    maximum_pending: usize,
    rejections: [u64; 3],
    actual_counts: [u64; 3],
    expected_probability_sums: [u128; 3],
    expected_reward_numerator: u128,
    pending: Vec<Opening>,
    users: BTreeSet<u64>,
}

impl Ledger {
    fn new(initial_pool: u128) -> Self {
        Self {
            initial_pool,
            pool: initial_pool,
            liabilities: 0,
            pending_fees: 0,
            vested_fees: 0,
            cash: initial_pool,
            in_flight: 0,
            accepted: 0,
            completed: 0,
            paid_rewards: 0,
            drawn_rewards: 0,
            failures: 0,
            checks: 0,
            minimum_pool: initial_pool,
            maximum_pool: initial_pool,
            health_transitions: 0,
            last_health: health(initial_pool),
            maximum_pending: 0,
            rejections: [0; 3],
            actual_counts: [0; 3],
            expected_probability_sums: [0; 3],
            expected_reward_numerator: 0,
            pending: Vec::new(),
            users: BTreeSet::new(),
        }
    }

    fn available(&self) -> u128 {
        self.pool - self.liabilities
    }

    fn check(&mut self) {
        self.minimum_pool = self.minimum_pool.min(self.pool);
        self.maximum_pool = self.maximum_pool.max(self.pool);
        assert!(
            self.pool >= self.liabilities,
            "pool cannot cover reservations"
        );
        assert_eq!(
            self.liabilities,
            self.pending
                .iter()
                .map(|opening| opening.reward.unwrap_or(MAX_REWARD))
                .sum::<u128>()
        );
        assert_eq!(self.pending_fees, self.pending.len() as u128 * FEE);
        assert_eq!(self.accepted, self.completed + self.pending.len() as u64);
        assert_eq!(self.vested_fees, u128::from(self.completed) * FEE);
        assert_eq!(self.users.len(), self.pending.len());
        assert_eq!(
            self.cash + self.in_flight,
            self.pool + self.pending_fees + self.vested_fees,
            "cash must reconcile while callbacks are in flight"
        );
        assert_eq!(
            self.cash + self.in_flight + self.paid_rewards,
            self.initial_pool + u128::from(self.accepted) * PRICE,
            "external token conservation"
        );
        let current_health = health(self.available());
        if current_health != self.last_health {
            self.health_transitions += 1;
            self.last_health = current_health;
        }
        self.checks += 1;
    }

    fn accept(&mut self, user: u64) -> bool {
        let available = self.available();
        let limit = match health(available) {
            Health::Healthy => 64,
            Health::Caution => 16,
            Health::Critical => 4,
        };
        let rejection = if self.users.contains(&user) {
            Some(0)
        } else if self.pending.len() >= limit {
            Some(1)
        } else if available < 5 * UNIT || available + CONTRIBUTION < MAX_REWARD {
            Some(2)
        } else {
            None
        };
        if let Some(reason) = rejection {
            self.rejections[reason] += 1;
            self.check();
            return false;
        }

        let odds = distribution(available);
        self.expected_probability_sums[0] += u128::from(odds.common);
        self.expected_probability_sums[1] += u128::from(odds.rare);
        self.expected_probability_sums[2] += u128::from(odds.legendary);
        self.expected_reward_numerator += odds.expected_numerator();
        self.pool += CONTRIBUTION;
        self.pending_fees += FEE;
        self.cash += PRICE;
        self.liabilities += MAX_REWARD;
        self.accepted += 1;
        self.users.insert(user);
        self.pending.push(Opening {
            user,
            odds,
            reward: None,
            state: State::AwaitingDraw,
            attempt: 0,
        });
        self.maximum_pending = self.maximum_pending.max(self.pending.len());
        self.check();
        true
    }

    fn draw(&mut self, index: usize, mode: OutcomeMode, rng: &mut SplitMix64) {
        assert_eq!(self.pending[index].state, State::AwaitingDraw);
        let reward = match mode {
            OutcomeMode::Random => self.pending[index]
                .odds
                .reward(rng.uniform(u64::from(DENOMINATOR)) as u32),
            OutcomeMode::Common => REWARDS[0],
            OutcomeMode::Legendary => REWARDS[2],
        };
        let tier = REWARDS.iter().position(|value| *value == reward).unwrap();
        self.actual_counts[tier] += 1;
        self.drawn_rewards += reward;
        self.liabilities -= MAX_REWARD - reward;
        self.pending[index].reward = Some(reward);
        self.pending[index].state = State::Claimable;
        self.check();
    }

    fn begin_payout(&mut self, index: usize) -> u64 {
        assert_eq!(self.pending[index].state, State::Claimable);
        let reward = self.pending[index].reward.unwrap();
        self.pending[index].state = State::Paying;
        self.pending[index].attempt += 1;
        self.cash -= reward;
        self.in_flight += reward;
        self.check();
        self.pending[index].attempt
    }

    fn finish_payout(&mut self, index: usize, attempt: u64, success: bool) -> bool {
        assert_eq!(self.pending[index].state, State::Paying);
        assert_eq!(self.pending[index].attempt, attempt);
        let reward = self.pending[index].reward.unwrap();
        self.in_flight -= reward;
        if success {
            self.pool -= reward;
            self.liabilities -= reward;
            self.pending_fees -= FEE;
            self.vested_fees += FEE;
            self.paid_rewards += reward;
            self.completed += 1;
            let opening = self.pending.remove(index);
            self.users.remove(&opening.user);
        } else {
            self.cash += reward;
            self.pending[index].state = State::Claimable;
            self.failures += 1;
        }
        self.check();
        success
    }

    fn settle_new(
        &mut self,
        scenario: &Scenario,
        draws: &mut SplitMix64,
        transfers: &mut SplitMix64,
    ) {
        let mut index = 0;
        while index < self.pending.len() {
            // Failed claims stay funded. An unrecovered claim is never redrawn.
            if self.pending[index].state != State::AwaitingDraw {
                index += 1;
                continue;
            }
            self.draw(index, scenario.outcome, draws);
            let mut completed = false;
            for _ in 0..if scenario.retry_failures { 32 } else { 1 } {
                let attempt = self.begin_payout(index);
                let success = transfers.uniform(100) >= scenario.failure_percent;
                if self.finish_payout(index, attempt, success) {
                    completed = true;
                    break;
                }
            }
            if !completed {
                index += 1;
            }
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct Point {
    attempt: u64,
    pool: u128,
    available: u128,
    liabilities: u128,
    pending: usize,
}

impl Point {
    fn take(attempt: u64, ledger: &Ledger) -> Self {
        Self {
            attempt,
            pool: ledger.pool,
            available: ledger.available(),
            liabilities: ledger.liabilities,
            pending: ledger.pending.len(),
        }
    }
}

#[derive(Debug, Serialize)]
struct ResultRow {
    scenario: Scenario,
    accepted: u64,
    rejected: u64,
    rejected_duplicate_pending: u64,
    rejected_concurrency: u64,
    rejected_liquidity: u64,
    completed: u64,
    pending: usize,
    maximum_pending: usize,
    final_pool: u128,
    minimum_pool: u128,
    maximum_pool: u128,
    mean_pool: f64,
    median_pool: f64,
    average_reward: f64,
    average_expected_reward: f64,
    actual_counts: [u64; 3],
    actual_frequencies: [f64; 3],
    expected_frequencies: [f64; 3],
    total_drawn_rewards: u128,
    total_paid_rewards: u128,
    liabilities: u128,
    pending_fees: u128,
    vested_fees: u128,
    failed_settlements: u64,
    health_transitions: u64,
    health_samples: [u64; 3],
    invariant_checks: u64,
    pool_samples: u64,
    trace: Vec<Point>,
}

fn run(scenario: Scenario) -> ResultRow {
    assert!(scenario.users > 0 && scenario.batch > 0 && scenario.failure_percent <= 100);
    let mut ledger = Ledger::new(scenario.initial_pool);
    let mut draws = SplitMix64(scenario.seed);
    let mut transfers = SplitMix64(scenario.seed ^ 0x8bd6e4a3f029c571);
    let mut samples = Vec::with_capacity(scenario.attempts as usize + 2);
    samples.push(ledger.pool);
    let mut trace = vec![Point::take(0, &ledger)];
    let stride = (scenario.attempts / 400).max(1);
    let mut health_samples = [0; 3];
    ledger.check();
    for attempt in 0..scenario.attempts {
        ledger.accept(attempt % scenario.users);
        if (attempt + 1) % scenario.batch == 0 {
            ledger.settle_new(&scenario, &mut draws, &mut transfers);
        }
        samples.push(ledger.pool);
        health_samples[match health(ledger.available()) {
            Health::Healthy => 0,
            Health::Caution => 1,
            Health::Critical => 2,
        }] += 1;
        if (attempt + 1) % stride == 0 || attempt + 1 == scenario.attempts {
            trace.push(Point::take(attempt + 1, &ledger));
        }
    }
    ledger.settle_new(&scenario, &mut draws, &mut transfers);
    ledger.check();
    samples.push(ledger.pool);
    if let Some(last) = trace.last_mut() {
        *last = Point::take(scenario.attempts, &ledger);
    }
    let minimum_pool = ledger.minimum_pool;
    let maximum_pool = ledger.maximum_pool;
    let mean_pool = samples.iter().sum::<u128>() as f64 / samples.len() as f64;
    let count = samples.len();
    let (_, middle, _) = samples.select_nth_unstable(count / 2);
    let upper = *middle;
    let median_pool = if count % 2 == 0 {
        (*samples[..count / 2].iter().max().unwrap() + upper) as f64 / 2.0
    } else {
        upper as f64
    };
    let accepted = ledger.accepted as f64;
    let average_reward = if ledger.accepted == 0 {
        0.0
    } else {
        ledger.drawn_rewards as f64 / accepted
    };
    let average_expected_reward = if ledger.accepted == 0 {
        0.0
    } else {
        ledger.expected_reward_numerator as f64 / f64::from(DENOMINATOR) / accepted
    };
    let actual_frequencies = ledger.actual_counts.map(|value| {
        if accepted == 0.0 {
            0.0
        } else {
            value as f64 / accepted
        }
    });
    let expected_frequencies = ledger.expected_probability_sums.map(|value| {
        if accepted == 0.0 {
            0.0
        } else {
            value as f64 / f64::from(DENOMINATOR) / accepted
        }
    });
    ResultRow {
        accepted: ledger.accepted,
        rejected: ledger.rejections.iter().sum(),
        rejected_duplicate_pending: ledger.rejections[0],
        rejected_concurrency: ledger.rejections[1],
        rejected_liquidity: ledger.rejections[2],
        completed: ledger.completed,
        pending: ledger.pending.len(),
        maximum_pending: ledger.maximum_pending,
        final_pool: ledger.pool,
        minimum_pool,
        maximum_pool,
        mean_pool,
        median_pool,
        average_reward,
        average_expected_reward,
        actual_counts: ledger.actual_counts,
        actual_frequencies,
        expected_frequencies,
        total_drawn_rewards: ledger.drawn_rewards,
        total_paid_rewards: ledger.paid_rewards,
        liabilities: ledger.liabilities,
        pending_fees: ledger.pending_fees,
        vested_fees: ledger.vested_fees,
        failed_settlements: ledger.failures,
        health_transitions: ledger.health_transitions,
        health_samples,
        invariant_checks: ledger.checks,
        pool_samples: count as u64,
        trace,
        scenario,
    }
}

#[derive(Debug, Serialize)]
struct FaucetResult {
    users: u64,
    attempts: u64,
    minted_accounts: u64,
    rejected_duplicate_claims: u64,
    total_minted: u128,
    unregister_then_reclaim_rejected: bool,
}

fn faucet(users: u64) -> FaucetResult {
    let mut claimed = BTreeSet::new();
    let mut registered = BTreeSet::new();
    let mut minted = 0;
    let mut rejected = 0;
    for _ in 0..10 {
        for user in 0..users {
            if claimed.insert(user) {
                registered.insert(user);
                minted += 1;
            } else {
                rejected += 1;
            }
        }
    }
    registered.remove(&0);
    let unregister_then_reclaim_rejected = !claimed.insert(0);
    assert!(unregister_then_reclaim_rejected);
    assert_eq!(minted, users);
    FaucetResult {
        users,
        attempts: users * 10 + 1,
        minted_accounts: minted,
        rejected_duplicate_claims: rejected + 1,
        total_minted: u128::from(minted) * 1_000 * UNIT,
        unregister_then_reclaim_rejected,
    }
}

fn scenarios(quick: bool) -> Vec<Scenario> {
    let counts: &[u64] = if quick {
        &[100, 1_000]
    } else {
        &[100, 1_000, 10_000, 100_000, 1_000_000]
    };
    let mut result = Vec::new();
    for seed in [1, 7, 42] {
        for attempts in counts {
            for initial in [500, 1_000, 1_500] {
                result.push(scenario("random-baseline", seed, *attempts, initial));
            }
            let mut growth = scenario("five-thousand-users-fixed-target", seed, *attempts, 1_000);
            growth.users = 5_000;
            result.push(growth);
        }
        let stress_count = if quick { 1_000 } else { 10_000 };
        for (name, initial, outcome) in [
            ("forced-common-streak", 1_000, OutcomeMode::Common),
            ("forced-legendary-streak", 1_000, OutcomeMode::Legendary),
            ("unfunded-pool", 0, OutcomeMode::Random),
        ] {
            let mut item = scenario(name, seed, stress_count, initial);
            item.outcome = outcome;
            result.push(item);
        }
        for (name, initial) in [
            ("healthy-concurrency", 2_000),
            ("caution-concurrency", 700),
            ("critical-concurrency", 100),
        ] {
            let mut item = scenario(name, seed, 1_000, initial);
            item.batch = 1_000;
            result.push(item);
        }
        for retry in [true, false] {
            let name = if retry {
                "quarter-transfers-fail-with-retry"
            } else {
                "quarter-transfers-fail-unrecovered"
            };
            let mut item = scenario(name, seed, stress_count, 1_000);
            item.failure_percent = 25;
            item.retry_failures = retry;
            result.push(item);
        }
    }
    result
}

#[derive(Serialize)]
struct Report<'a> {
    schema_version: u32,
    randomness: &'static str,
    units: &'static str,
    target: u128,
    quick: bool,
    results: &'a [ResultRow],
    faucet: &'a [FaucetResult],
}

fn metrics_csv(results: &[ResultRow]) -> String {
    let mut csv = String::from(
        "scenario,seed,attempts,users,initial_pool,accepted,rejected,rejected_duplicate_pending,rejected_concurrency,rejected_liquidity,completed,pending,maximum_pending,final_pool,minimum_pool,maximum_pool,mean_pool,median_pool,average_reward,average_expected_reward,common_count,rare_count,legendary_count,common_frequency,rare_frequency,legendary_frequency,expected_common_frequency,expected_rare_frequency,expected_legendary_frequency,total_drawn_rewards,total_paid_rewards,liabilities,pending_fees,vested_fees,failed_settlements,health_transitions,healthy_samples,caution_samples,critical_samples,invariant_checks,pool_samples\n",
    );
    for row in results {
        let fields = vec![
            row.scenario.name.clone(),
            row.scenario.seed.to_string(),
            row.scenario.attempts.to_string(),
            row.scenario.users.to_string(),
            row.scenario.initial_pool.to_string(),
            row.accepted.to_string(),
            row.rejected.to_string(),
            row.rejected_duplicate_pending.to_string(),
            row.rejected_concurrency.to_string(),
            row.rejected_liquidity.to_string(),
            row.completed.to_string(),
            row.pending.to_string(),
            row.maximum_pending.to_string(),
            row.final_pool.to_string(),
            row.minimum_pool.to_string(),
            row.maximum_pool.to_string(),
            row.mean_pool.to_string(),
            row.median_pool.to_string(),
            row.average_reward.to_string(),
            row.average_expected_reward.to_string(),
            row.actual_counts[0].to_string(),
            row.actual_counts[1].to_string(),
            row.actual_counts[2].to_string(),
            row.actual_frequencies[0].to_string(),
            row.actual_frequencies[1].to_string(),
            row.actual_frequencies[2].to_string(),
            row.expected_frequencies[0].to_string(),
            row.expected_frequencies[1].to_string(),
            row.expected_frequencies[2].to_string(),
            row.total_drawn_rewards.to_string(),
            row.total_paid_rewards.to_string(),
            row.liabilities.to_string(),
            row.pending_fees.to_string(),
            row.vested_fees.to_string(),
            row.failed_settlements.to_string(),
            row.health_transitions.to_string(),
            row.health_samples[0].to_string(),
            row.health_samples[1].to_string(),
            row.health_samples[2].to_string(),
            row.invariant_checks.to_string(),
            row.pool_samples.to_string(),
        ];
        writeln!(csv, "{}", fields.join(",")).unwrap();
    }
    csv
}

fn traces_csv(results: &[ResultRow]) -> String {
    let mut csv = String::from(
        "scenario,seed,attempts,users,initial_pool,attempt,pool,available,liabilities,pending\n",
    );
    for row in results {
        for point in &row.trace {
            writeln!(
                csv,
                "{},{},{},{},{},{},{},{},{},{}",
                row.scenario.name,
                row.scenario.seed,
                row.scenario.attempts,
                row.scenario.users,
                row.scenario.initial_pool,
                point.attempt,
                point.pool,
                point.available,
                point.liabilities,
                point.pending
            )
            .unwrap();
        }
    }
    csv
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn chart(
    title: &str,
    series: &[(String, Vec<(f64, f64)>)],
    x_label: &str,
    y_label: &str,
) -> String {
    let colors = [
        "#0369a1", "#b45309", "#15803d", "#a21caf", "#dc2626", "#475569",
    ];
    let maximum_x = series
        .iter()
        .flat_map(|(_, points)| points.iter().map(|p| p.0))
        .fold(1.0_f64, f64::max);
    let maximum_y = series
        .iter()
        .flat_map(|(_, points)| points.iter().map(|p| p.1))
        .fold(1.0_f64, f64::max)
        * 1.08;
    let height = 460 + series.len() * 24;
    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1000\" height=\"{height}\" viewBox=\"0 0 1000 {height}\" role=\"img\"><title>{}</title><rect width=\"100%\" height=\"100%\" fill=\"white\"/><g font-family=\"system-ui,sans-serif\" font-size=\"14\" fill=\"#0f172a\"><text x=\"80\" y=\"30\" font-size=\"20\">{}</text>",
        escape(title),
        escape(title)
    );
    for tick in 0..=5 {
        let fraction = tick as f64 / 5.0;
        let x = 80.0 + fraction * 850.0;
        let y = 390.0 - fraction * 320.0;
        write!(svg, "<path d=\"M80 {y}H930\" stroke=\"#e2e8f0\"/><text x=\"70\" y=\"{}\" text-anchor=\"end\">{:.2}</text><text x=\"{x}\" y=\"415\" text-anchor=\"middle\">{:.0}</text>", y + 5.0, fraction * maximum_y, fraction * maximum_x).unwrap();
    }
    write!(svg, "<path d=\"M80 60V390H930\" fill=\"none\" stroke=\"#64748b\"/><text x=\"500\" y=\"444\" text-anchor=\"middle\">{}</text><text transform=\"translate(20 230) rotate(-90)\" text-anchor=\"middle\">{}</text>", escape(x_label), escape(y_label)).unwrap();
    for (index, (label, points)) in series.iter().enumerate() {
        let color = colors[index % colors.len()];
        let mut coordinates = String::new();
        for (x, y) in points {
            write!(
                coordinates,
                "{:.2},{:.2} ",
                80.0 + x / maximum_x * 850.0,
                390.0 - y / maximum_y * 320.0
            )
            .unwrap();
        }
        let legend_y = 475 + index * 24;
        write!(svg, "<polyline points=\"{coordinates}\" fill=\"none\" stroke=\"{color}\" stroke-width=\"2\"/><path d=\"M80 {legend_y}h28\" stroke=\"{color}\" stroke-width=\"3\"/><text x=\"118\" y=\"{}\">{}</text>", legend_y + 5, escape(label)).unwrap();
    }
    svg.push_str("</g></svg>\n");
    svg
}

fn financial_proof() -> &'static str {
    "The shared formula bounds A at 2,000 USDI before arithmetic. Both curves are constant beyond that point. It computes the clamped target EV, floors the rare probability, and assigns the remainder to common. Every tier stays positive and the probabilities sum to 1,000,000. The rare floor loses less than 0.9 token base units of EV. The target floor loses less than one more base unit, so the continuous-curve error is below 1.9 base units. At A=1,000 USDI, the actual EV is 0.9499998 USDI. The contribution is 0.95 USDI, so the rounded equilibrium has a 0.0000002 USDI upward drift per accepted opening at that point.\n\nAcceptance increases P by 0.95 USDI and L by 5 USDI only when the new pool covers every reservation. The pre-payment minimum A is 5 USDI. The draw replaces the maximum reservation with the immutable reward. A successful callback decreases both P and L by that reward. A failed transfer changes neither P nor L. Fees stay outside P and vest only after a successful payout. Each transition checks P>=L, reservation totals, account uniqueness, fee allocation, and token conservation. During a transfer, cash plus the in-flight amount equals P plus all fee balances."
}

fn markdown(results: &[ResultRow], faucets: &[FaucetResult], quick: bool) -> String {
    let checks: u64 = results.iter().map(|r| r.invariant_checks).sum();
    let attempts: u64 = results.iter().map(|r| r.scenario.attempts).sum();
    let mut text = format!(
        "# USDI pool simulation report\n\nThis deterministic offline model runs {} scenarios and {attempts} purchase attempts with seeds 1, 7, and 42. All {checks} transition invariant checks passed. {}\n\nUSDI has no USD backing and no real monetary value. The model does not execute deployed contracts or prove their receipt behavior. Contract unit and integration tests cover implementation behavior separately.\n\n## Model and financial proofs\n\n{}\n\nThe target remains 1,000 USDI when the user population grows from 1,000 to 5,000. Sequential users do not change the probability formula. Each account has at most one unresolved opening. Healthy, Caution, and Critical states admit at most 64, 16, and 4 pending openings respectively. Existing reservations remain valid after a health downgrade.\n\nSplitMix64 and unbiased rejection sampling supply simulation-only draws. Payout failures use an independent seeded stream. Recovered-failure scenarios retry the stored reward up to 32 times. Unrecovered failures retain their full reward liability and unvested fee. The model never times out an in-flight payment. Forced streaks deliberately override sampled outcomes and are adverse or favorable stress cases, not probability estimates.\n\n## Random pool paths\n\n![Seed 42 pool paths](usdi-simulations/pool-paths.svg)\n\nThe table uses the longest random run for seed 42 at each reserve level. Amounts are USDI. The JSON and CSV files contain every seed, volume, stress case, and raw base-unit metric.\n\n| Initial pool | Users | Attempts | Accepted | Rejected | Final pool | Minimum | Maximum | Mean | Median | Average reward |\n| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n",
        results.len(),
        if quick {
            "This is a quick artifact check, not the full requested run."
        } else {
            "The full requested volume grid includes 100, 1,000, 10,000, 100,000, and 1,000,000 attempts."
        },
        financial_proof()
    );
    let longest = results
        .iter()
        .filter(|r| r.scenario.name == "random-baseline")
        .map(|r| r.scenario.attempts)
        .max()
        .unwrap_or(0);
    for row in results.iter().filter(|r| {
        r.scenario.seed == 42
            && r.scenario.attempts == longest
            && (r.scenario.name == "random-baseline"
                || r.scenario.name == "five-thousand-users-fixed-target")
    }) {
        writeln!(
            text,
            "| {:.0} | {} | {} | {} | {} | {:.6} | {:.6} | {:.6} | {:.6} | {:.6} | {:.6} |",
            row.scenario.initial_pool as f64 / UNIT as f64,
            row.scenario.users,
            row.scenario.attempts,
            row.accepted,
            row.rejected,
            row.final_pool as f64 / UNIT as f64,
            row.minimum_pool as f64 / UNIT as f64,
            row.maximum_pool as f64 / UNIT as f64,
            row.mean_pool / UNIT as f64,
            row.median_pool / UNIT as f64,
            row.average_reward / UNIT as f64
        )
        .unwrap();
    }
    text.push_str("\n## Stress cases\n\n![Seed 42 stress pool paths](usdi-simulations/stress-paths.svg)\n\n| Scenario | Seed | Accepted | Rejected | Maximum pending | Failed transfers | Pending | Liabilities, USDI | Pending fees, USDI | Vested fees, USDI |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n");
    for row in results.iter().filter(|r| {
        r.scenario.seed == 42
            && r.scenario.name != "random-baseline"
            && r.scenario.name != "five-thousand-users-fixed-target"
    }) {
        writeln!(
            text,
            "| {} | {} | {} | {} | {} | {} | {} | {:.6} | {:.6} | {:.6} |",
            row.scenario.name,
            row.scenario.seed,
            row.accepted,
            row.rejected,
            row.maximum_pending,
            row.failed_settlements,
            row.pending,
            row.liabilities as f64 / UNIT as f64,
            row.pending_fees as f64 / UNIT as f64,
            row.vested_fees as f64 / UNIT as f64
        )
        .unwrap();
    }
    text.push_str("\nA long legendary streak exhausts available liquidity and causes full rejection of later purchases. The reserve rule prevents accepting an unfunded reward. Failed claims can fill account and concurrency slots; the model preserves their funding rather than treating their tokens as available pool liquidity. A common-only streak grows the pool and demonstrates that probabilities clamp without overflow.\n\n## Empirical and expected frequencies\n\nExpected frequencies average the frozen quote probabilities across accepted openings. They are not the probabilities at the final reserve. Actual frequencies count draws, including rewards that remain unpaid after transfer failure.\n\n| Initial pool, USDI | Users | Common actual / expected | Rare actual / expected | Legendary actual / expected | Expected average reward, USDI | Health transitions |\n| ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n");
    for row in results.iter().filter(|r| {
        r.scenario.seed == 42
            && r.scenario.attempts == longest
            && (r.scenario.name == "random-baseline"
                || r.scenario.name == "five-thousand-users-fixed-target")
    }) {
        writeln!(
            text,
            "| {:.0} | {} | {:.6} / {:.6} | {:.6} / {:.6} | {:.6} / {:.6} | {:.6} | {} |",
            row.scenario.initial_pool as f64 / UNIT as f64,
            row.scenario.users,
            row.actual_frequencies[0],
            row.expected_frequencies[0],
            row.actual_frequencies[1],
            row.expected_frequencies[1],
            row.actual_frequencies[2],
            row.expected_frequencies[2],
            row.average_expected_reward / UNIT as f64,
            row.health_transitions
        )
        .unwrap();
    }
    text.push_str("\n![Shared expected reward curve](usdi-simulations/expected-reward.svg)\n\n## Faucet duplication model\n\nThis separate model keeps claim eligibility after token registration is removed. Faucet issuance never automatically adds backing to the case pool. These results check the model's state rule, not a deployed faucet.\n\n| Users | Claim attempts | Accounts minted | Duplicate attempts rejected | Total minted, USDI | Unregister then reclaim rejected |\n| ---: | ---: | ---: | ---: | ---: | --- |\n");
    for result in faucets {
        writeln!(
            text,
            "| {} | {} | {} | {} | {} | {} |",
            result.users,
            result.attempts,
            result.minted_accounts,
            result.rejected_duplicate_claims,
            result.total_minted / UNIT,
            result.unregister_then_reclaim_rejected
        )
        .unwrap();
    }
    text.push_str("\n## Data definitions and limits\n\n`results.json` contains full scenario configuration, counts, frequencies, liabilities, fees, sampled paths, and all requested pool statistics. `metrics.csv` contains one row per scenario. `traces.csv` downsamples paths to about 400 intervals per scenario. Money columns use exact USDI base units unless their name denotes an average. Floating point is used only for reported averages, frequencies, and graph coordinates. Ledger transitions and probability calculations use integers.\n\nPool mean and median use the initial pool, the pool after each purchase attempt and its scheduled batch settlements, and the final pool after the last batch. Minimum and maximum include every checked ledger transition, including payment acceptance before payout. Health sample counts cover the end of each attempt. Health transitions count every checked ledger transition, including temporary reservation pressure. Attempt counts include rejected purchases; accepted volume can be lower under insolvency, concurrency, or unpaid-claim pressure. No fees are withdrawn during these runs.\n\nThe simulation supports expected mean reversion, not a solvency or return guarantee. Finite samples can have large drawdowns. Protocol randomness in the actual Testnet demonstration is not a VRF. Validator ordering, withholding, and retry timing can affect outcomes. The simulation PRNG does not model those attacks, asynchronous latency, stale quotes, gas exhaustion, storage costs, transaction fees, or network throughput. A successful model run cannot establish production fairness or receipt safety. No parameters are tuned to improve these results.\n\nRegenerate the full artifacts from the repository root with `cargo run --release --manifest-path contracts/Cargo.toml -p iroh-economics --bin simulate -- --output .`. Add `--quick` only to check artifact generation with smaller volumes. The generator writes only `docs/usdi-pool-simulation-report.md` and `docs/usdi-simulations/`.\n");
    text
}

fn write_artifacts(
    root: &Path,
    results: &[ResultRow],
    faucets: &[FaucetResult],
    quick: bool,
) -> Result<(), Box<dyn Error>> {
    let directory = root.join("docs/usdi-simulations");
    fs::create_dir_all(&directory)?;
    let report = Report {
        schema_version: 1,
        randomness: "SplitMix64; simulation only; unbiased bounded draws",
        units: "USDI base units, 1 USDI = 1000000",
        target: TARGET,
        quick,
        results,
        faucet: faucets,
    };
    fs::write(
        directory.join("results.json"),
        serde_json::to_string_pretty(&report)?,
    )?;
    fs::write(directory.join("metrics.csv"), metrics_csv(results))?;
    fs::write(directory.join("traces.csv"), traces_csv(results))?;
    let longest = results
        .iter()
        .map(|r| r.scenario.attempts)
        .max()
        .unwrap_or(0);
    let baseline = results
        .iter()
        .filter(|r| {
            r.scenario.name == "random-baseline"
                && r.scenario.seed == 42
                && r.scenario.attempts == longest
        })
        .map(|r| {
            (
                format!("Initial {} USDI, seed 42", r.scenario.initial_pool / UNIT),
                r.trace
                    .iter()
                    .map(|p| (p.attempt as f64, p.pool as f64 / UNIT as f64))
                    .collect(),
            )
        })
        .collect::<Vec<_>>();
    fs::write(
        directory.join("pool-paths.svg"),
        chart(
            "Random pool paths with fixed 1,000 USDI target",
            &baseline,
            "Purchase attempts",
            "Pool, USDI",
        ),
    )?;
    let stress = results
        .iter()
        .filter(|r| {
            r.scenario.seed == 42
                && matches!(
                    r.scenario.name.as_str(),
                    "forced-common-streak"
                        | "forced-legendary-streak"
                        | "quarter-transfers-fail-unrecovered"
                        | "quarter-transfers-fail-with-retry"
                )
        })
        .map(|r| {
            (
                r.scenario.name.clone(),
                r.trace
                    .iter()
                    .map(|p| (p.attempt as f64, p.pool as f64 / UNIT as f64))
                    .collect(),
            )
        })
        .collect::<Vec<_>>();
    fs::write(
        directory.join("stress-paths.svg"),
        chart(
            "Stress cases, seed 42",
            &stress,
            "Purchase attempts",
            "Pool, USDI",
        ),
    )?;
    let ev_points = (0..=2_200)
        .map(|available| {
            let expected = distribution(available * UNIT).expected_numerator() as f64
                / f64::from(DENOMINATOR)
                / UNIT as f64;
            (available as f64, expected)
        })
        .collect::<Vec<_>>();
    let contribution = vec![(0.0, 0.95), (2_200.0, 0.95)];
    fs::write(
        directory.join("expected-reward.svg"),
        chart(
            "Expected reward and pool contribution",
            &[
                ("Integer expected reward".into(), ev_points),
                ("0.95 USDI contribution".into(), contribution),
            ],
            "Available liquidity, USDI",
            "USDI per opening",
        ),
    )?;
    fs::write(
        root.join("docs/usdi-pool-simulation-report.md"),
        markdown(results, faucets, quick),
    )?;
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    let mut output = None;
    let mut quick = false;
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--output" => output = Some(args.next().ok_or("--output requires a repository root")?),
            "--quick" => quick = true,
            _ => return Err(format!(
                "unknown argument {argument}; usage: simulate --output <repository-root> [--quick]"
            )
            .into()),
        }
    }
    let output =
        output.ok_or("explicit --output <repository-root> is required; no artifacts written")?;
    let results = scenarios(quick).into_iter().map(run).collect::<Vec<_>>();
    let faucets = [faucet(1_000), faucet(5_000)];
    write_artifacts(Path::new(&output), &results, &faucets, quick)?;
    let attempts: u64 = results.iter().map(|r| r.scenario.attempts).sum();
    let checks: u64 = results.iter().map(|r| r.invariant_checks).sum();
    println!(
        "{} scenarios; {attempts} attempts; {checks} invariant checks passed. Artifacts: {output}/docs/usdi-pool-simulation-report.md",
        results.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitmix_reference_sequence_is_stable() {
        let mut rng = SplitMix64(0);
        assert_eq!(rng.next(), 0xe220a8397b1dcdaf);
        assert_eq!(rng.next(), 0x6e789e6aa1b965f4);
        assert_eq!(rng.next(), 0x06c45d188009454f);
    }

    #[test]
    fn identical_seed_produces_identical_ledger_and_report() {
        let item = scenario("determinism", 42, 10_000, 1_000);
        assert_eq!(
            serde_json::to_string(&run(item.clone())).unwrap(),
            serde_json::to_string(&run(item)).unwrap()
        );
    }

    #[test]
    fn funded_common_draw_conserves_cash_and_vests_only_paid_fee() {
        let mut ledger = Ledger::new(1_000 * UNIT);
        assert!(ledger.accept(7));
        assert_eq!(ledger.pool, 1_000_950_000);
        assert_eq!(ledger.liabilities, 5_000_000);
        assert_eq!(ledger.pending_fees, 50_000);
        ledger.draw(0, OutcomeMode::Common, &mut SplitMix64(1));
        assert_eq!(ledger.liabilities, 100_000);
        let attempt = ledger.begin_payout(0);
        assert_eq!(ledger.in_flight, 100_000);
        assert_eq!(ledger.cash, 1_000_900_000);
        assert_eq!(ledger.vested_fees, 0);
        assert!(ledger.finish_payout(0, attempt, true));
        assert_eq!(ledger.pool, 1_000_850_000);
        assert_eq!(ledger.cash, 1_000_900_000);
        assert_eq!(ledger.liabilities, 0);
        assert_eq!(ledger.pending_fees, 0);
        assert_eq!(ledger.vested_fees, 50_000);
    }

    #[test]
    fn failed_transfer_preserves_reward_and_retries_without_a_draw() {
        let mut ledger = Ledger::new(1_000 * UNIT);
        assert!(ledger.accept(1));
        ledger.draw(0, OutcomeMode::Legendary, &mut SplitMix64(1));
        let first = ledger.begin_payout(0);
        assert!(!ledger.finish_payout(0, first, false));
        assert_eq!(ledger.pool, 1_000_950_000);
        assert_eq!(ledger.liabilities, 5_000_000);
        assert_eq!(ledger.pending[0].reward, Some(5_000_000));
        assert_eq!(ledger.pending_fees, 50_000);
        assert_eq!(ledger.vested_fees, 0);
        let retry = ledger.begin_payout(0);
        assert_eq!(retry, 2);
        assert!(ledger.finish_payout(0, retry, true));
        assert_eq!(ledger.pool, 995_950_000);
        assert_eq!(ledger.actual_counts, [0, 0, 1]);
        assert_eq!(ledger.drawn_rewards, 5_000_000);
        assert_eq!(ledger.paid_rewards, 5_000_000);
    }

    #[test]
    fn forced_legendary_streak_rejects_before_insolvency() {
        let mut item = scenario("legendary", 1, 1_000, 1_000);
        item.outcome = OutcomeMode::Legendary;
        let result = run(item);
        assert_eq!(result.accepted, 246);
        assert_eq!(result.rejected, 754);
        assert_eq!(result.final_pool, 3_700_000);
        assert_eq!(result.liabilities, 0);
        assert_eq!(result.total_paid_rewards, 1_230_000_000);
    }

    #[test]
    fn modeled_concurrency_caps_are_64_16_and_4() {
        for (initial, expected) in [(2_000, 64), (700, 16), (100, 4)] {
            let mut item = scenario("concurrency", 42, 1_000, initial);
            item.batch = 1_000;
            let result = run(item);
            assert_eq!(result.accepted, expected);
            assert_eq!(result.maximum_pending, expected as usize);
            assert_eq!(result.rejected, 1_000 - expected);
            assert_eq!(result.pending, 0);
        }
    }

    #[test]
    fn unpaid_rewards_and_fees_stay_reserved() {
        let mut item = scenario("all-fail", 42, 1_000, 1_000);
        item.failure_percent = 100;
        item.retry_failures = false;
        let result = run(item);
        assert!(result.pending > 0);
        assert_eq!(result.accepted, result.pending as u64);
        assert_eq!(result.total_paid_rewards, 0);
        assert_eq!(result.liabilities, result.total_drawn_rewards);
        assert_eq!(result.vested_fees, 0);
        assert_eq!(result.pending_fees, u128::from(result.accepted) * 50_000);
        assert_eq!(
            result.final_pool,
            1_000_000_000 + u128::from(result.accepted) * 950_000
        );
    }

    #[test]
    fn empty_pool_rejects_all_payments_without_credits() {
        let result = run(scenario("empty", 1, 1_000, 0));
        assert_eq!(result.accepted, 0);
        assert_eq!(result.rejected_liquidity, 1_000);
        assert_eq!(result.final_pool, 0);
        assert_eq!(
            result.pending_fees + result.vested_fees + result.liabilities,
            0
        );
    }

    #[test]
    fn user_growth_does_not_change_fixed_target_or_sequential_economics() {
        let base = run(scenario("users", 7, 10_000, 1_000));
        let mut growth = scenario("users", 7, 10_000, 1_000);
        growth.users = 5_000;
        let growth = run(growth);
        assert_eq!(base.final_pool, growth.final_pool);
        assert_eq!(base.actual_counts, growth.actual_counts);
        assert_eq!(base.expected_frequencies, growth.expected_frequencies);
        assert_eq!(base.liabilities, growth.liabilities);
    }

    #[test]
    fn second_payment_for_the_same_pending_user_is_fully_rejected() {
        let mut ledger = Ledger::new(1_000 * UNIT);
        assert!(ledger.accept(7));
        assert!(!ledger.accept(7));
        assert_eq!(ledger.accepted, 1);
        assert_eq!(ledger.rejections, [1, 0, 0]);
        assert_eq!(ledger.pool, 1_000_950_000);
        assert_eq!(ledger.cash, 1_001_000_000);
        assert_eq!(ledger.liabilities, 5_000_000);
        assert_eq!(ledger.pending_fees, 50_000);
    }

    #[test]
    fn faucet_claims_are_permanent_after_unregistration() {
        let result = faucet(1_000);
        assert_eq!(result.minted_accounts, 1_000);
        assert_eq!(result.rejected_duplicate_claims, 9_001);
        assert_eq!(result.total_minted, 1_000_000_000_000);
        assert!(result.unregister_then_reclaim_rejected);
    }

    #[test]
    fn csv_contains_all_metrics_and_svg_has_accessible_title() {
        let result = run(scenario("artifacts", 1, 100, 1_000));
        let csv = metrics_csv(&[result]);
        let lines = csv.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].split(',').count(), lines[1].split(',').count());
        assert!(lines[0].contains("failed_settlements,health_transitions"));
        let svg = chart(
            "Pool & reserve",
            &[("test".into(), vec![(0.0, 1_000.0), (100.0, 900.0)])],
            "Attempts",
            "USDI",
        );
        assert!(svg.contains("<title>Pool &amp; reserve</title>"));
        assert!(svg.contains("<polyline"));
    }
}
