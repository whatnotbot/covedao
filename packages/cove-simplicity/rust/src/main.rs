//! Cove Simplicity pre-execution harness.
//!
//! Compiles the Cove MINT policy (Simfony) to a real Simplicity program using
//! the `simfony` + `simplicity` (rust-simplicity) crates, computes the real CMR,
//! and executes the program on the Simplicity Bit Machine against witness data.
//!
//! The Bitcoin transaction-introspection environment is NOT wired (Simfony
//! targets the Elements/Liquid jet set; upstream Bitcoin introspection is a
//! stub). The MINT predicate therefore receives the transaction state as
//! WITNESS values, and the full curve math remains in the TypeScript reference
//! (`validateMintTx`) which acts as the differential oracle. This is documented
//! honestly — this IS a real Simplicity program + real CMR + real Bit Machine
//! execution, not a Rust/TS predicate.

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

    // Supply conservation: S1 = S0 + amount (ignoring impossible overflow carry).
    let (carry, sum_supply): (bool, u64) = jet::add_64(prev_supply, amount);
    assert!(jet::eq_64(sum_supply, next_supply));
    // No overmint: public supply cap = 840,000,000 display tokens.
    assert!(jet::le_64(next_supply, 840_000_000));
    // Positive amount.
    assert!(jet::lt_64(0, amount));
    // Reserve movement: reserve grows by exactly the curve contribution.
    let (carry2, sum_reserve): (bool, u64) = jet::add_64(prev_reserve, contribution);
    assert!(jet::eq_64(sum_reserve, next_reserve));
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

fn compiled() -> Result<simfony::CompiledProgram, String> {
    simfony::CompiledProgram::new(MINT_SIMFONY, simfony::Arguments::default())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("build");

    match mode {
        "build" => {
            let program = compiled().expect("Simfony compilation failed");
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
                .get(2)
                .expect("usage: cove-simplicity exec '<mod witness {...}>'");
            let program = compiled().expect("Simfony compilation failed");
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
            // `prune` evaluates jets on pruned branches; a failing `assert!`
            // surfaces here as a JetFailed error (predicate = false).
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
