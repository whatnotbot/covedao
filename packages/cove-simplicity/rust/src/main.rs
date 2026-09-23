//! Cove Simplicity pre-execution harness.
//!
//! Compiles the Cove MINT and REDEEM policies (Simfony) to real Simplicity
//! programs using the `simfony` + `simplicity` (rust-simplicity) crates,
//! computes their real CMRs, and executes them on the Simplicity Bit Machine.
//!
//! The Bitcoin transaction-introspection environment is NOT wired (Simfony
//! targets the Elements/Liquid jet set; upstream Bitcoin introspection is a
//! stub). Predicates receive the transaction state as WITNESS values; the
//! TypeScript reference (`validateMintTx` / `quoteRedeem`) is the differential
//! oracle. This IS real Simplicity (real CMR + real Bit Machine), not Rust/TS.

use simfony::parse::ParseFromStr;
use simfony::simplicity::BitMachine;
use simfony::simplicity::HasCmr;

/// The frozen Cove MINT policy in Simfony (kept in sync with src/mint.simf).
const MINT_SIMFONY: &str = r#"
fn main() {
    let amount: u64 = witness::AMOUNT;
    let prev_supply: u64 = witness::PREV_SUPPLY;
    let next_supply: u64 = witness::NEXT_SUPPLY;
    let prev_reserve: u64 = witness::PREV_RESERVE;
    let next_reserve: u64 = witness::NEXT_RESERVE;
    let contribution: u64 = witness::CONTRIBUTION;

    // Supply conservation: S1 = S0 + amount; NO u64 overflow.
    let (carry, sum_supply): (bool, u64) = jet::add_64(prev_supply, amount);
    assert!(jet::le_64(prev_supply, sum_supply));
    assert!(jet::eq_64(sum_supply, next_supply));
    // No overmint: public supply cap = 840,000,000 display tokens.
    assert!(jet::le_64(next_supply, 840_000_000));
    // Positive amount.
    assert!(jet::lt_64(0, amount));
    // Reserve movement: reserve grows by exactly the curve contribution; NO overflow.
    let (carry2, sum_reserve): (bool, u64) = jet::add_64(prev_reserve, contribution);
    assert!(jet::le_64(prev_reserve, sum_reserve));
    assert!(jet::eq_64(sum_reserve, next_reserve));
}
"#;

/// The frozen Cove REDEEM (sell-to-backing) policy in Simfony.
const REDEEM_SIMFONY: &str = r#"
fn main() {
    let amount: u64 = witness::AMOUNT;
    let old_supply: u64 = witness::OLD_SUPPLY;
    let new_supply: u64 = witness::NEW_SUPPLY;
    let old_backing: u64 = witness::OLD_BACKING;
    let new_backing: u64 = witness::NEW_BACKING;
    let payout: u64 = witness::PAYOUT;

    // Positive amount.
    assert!(jet::lt_64(0, amount));
    // No underflow: amount <= old supply.
    assert!(jet::le_64(amount, old_supply));
    // Supply conservation: new = old - amount; NO borrow.
    let (borrow, diff): (bool, u64) = jet::subtract_64(old_supply, amount);
    assert!(jet::eq_64(diff, new_supply));
    // Backing conservation: newBacking = oldBacking - payout; NO borrow.
    assert!(jet::le_64(payout, old_backing));
    let (borrow2, diff2): (bool, u64) = jet::subtract_64(old_backing, payout);
    assert!(jet::eq_64(diff2, new_backing));
}
"#;

#[derive(serde::Serialize)]
struct BuildOutput {
    cmr: String,
    program: String,
}

#[derive(serde::Serialize)]
struct ExecOutput {
    cmr: String,
    result: String,
}

fn source_for(policy: &str) -> &'static str {
    match policy {
        "mint" => MINT_SIMFONY,
        "redeem" => REDEEM_SIMFONY,
        other => {
            eprintln!("unknown policy: {other} (expected mint|redeem)");
            std::process::exit(2);
        }
    }
}

fn compiled(policy: &str) -> Result<simfony::CompiledProgram, String> {
    simfony::CompiledProgram::new(source_for(policy), simfony::Arguments::default())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("build");
    let policy = args.get(2).map(String::as_str).unwrap_or("mint");

    match mode {
        "build" => {
            let program = compiled(policy).expect("Simfony compilation failed");
            let cmr = program.commit().cmr();
            let bytes = program.commit().encode_to_vec();
            use base64::Engine;
            let out = BuildOutput {
                cmr: hex::encode(cmr.to_byte_array()),
                program: base64::engine::general_purpose::STANDARD.encode(bytes),
            };
            println!("{}", serde_json::to_string(&out).unwrap());
        }
        "exec" => {
            let witness_str = args
                .get(3)
                .expect("usage: cove-simplicity exec <mint|redeem> '<mod witness {...}>'");
            let program = compiled(policy).expect("Simfony compilation failed");
            let cmr = program.commit().cmr();
            let witness = simfony::WitnessValues::parse_from_str(witness_str)
                .expect("invalid witness values");
            let satisfied = match program.satisfy(witness) {
                Ok(s) => s,
                Err(_) => {
                    let out = ExecOutput {
                        cmr: hex::encode(cmr.to_byte_array()),
                        result: "FAIL".to_string(),
                    };
                    println!("{}", serde_json::to_string(&out).unwrap());
                    return;
                }
            };
            let redeem = satisfied.redeem();
            let env = simfony::dummy_env::dummy();
            let pruned = match redeem.prune(&env) {
                Ok(p) => p,
                Err(_) => {
                    let out = ExecOutput {
                        cmr: hex::encode(cmr.to_byte_array()),
                        result: "FAIL".to_string(),
                    };
                    println!("{}", serde_json::to_string(&out).unwrap());
                    return;
                }
            };
            let mut mac = match BitMachine::for_program(pruned.as_ref()) {
                Ok(m) => m,
                Err(_) => {
                    let out = ExecOutput {
                        cmr: hex::encode(cmr.to_byte_array()),
                        result: "FAIL".to_string(),
                    };
                    println!("{}", serde_json::to_string(&out).unwrap());
                    return;
                }
            };
            let result = match mac.exec(pruned.as_ref(), &env) {
                Ok(_) => "PASS",
                Err(_) => "FAIL",
            };
            let out = ExecOutput {
                cmr: hex::encode(cmr.to_byte_array()),
                result: result.to_string(),
            };
            println!("{}", serde_json::to_string(&out).unwrap());
        }
        other => {
            eprintln!("unknown mode: {other}");
            std::process::exit(2);
        }
    }
}
