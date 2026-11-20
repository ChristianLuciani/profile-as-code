#!/usr/bin/env node

/**
 * Fragility Test Tool
 * 
 * Part of the Business Viability Framework for venture-as-code
 * 
 * Usage:
 *   node scripts/fragility-test.js [options]
 * 
 * Options:
 *   --tam <value>        TAM value or range (e.g., "180-250")
 *   --sam <value>        SAM value or range (e.g., "45-90")
 *   --som <value>        SOM value or range (e.g., "9-27")
 *   --break-even <value> Break-even clients (e.g., "17")
 *   --ticket <value>      Monthly ticket price (e.g., "300")
 *   --cogs <value>        Cost of goods sold per client (e.g., "150")
 *   --fixed-costs <value> Monthly fixed costs (e.g., "2500")
 *   --interactive         Run in interactive mode
 *   --help                Show this help
 * 
 * Examples:
 *   node scripts/fragility-test.js --tam "180-250" --sam "45-90" --som "9-27" --break-even 17
 *   node scripts/fragility-test.js --ticket 300 --cogs 150 --fixed-costs 2500
 *   node scripts/fragility-test.js --interactive
 */

import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a range string (e.g., "10-20") into min and max values
 */
function parseRange(rangeStr) {
  if (typeof rangeStr !== 'string') {
    return { min: Number(rangeStr), max: Number(rangeStr) };
  }
  
  if (rangeStr.includes('-')) {
    const [min, max] = rangeStr.split('-').map(Number);
    return { min, max };
  }
  
  const value = Number(rangeStr);
  return { min: value, max: value };
}

/**
 * Calculate gross margin per client
 */
function calculateGrossMargin(ticket, cogs) {
  return ticket - cogs;
}

/**
 * Calculate break-even clients
 */
function calculateBreakEven(fixedCosts, grossMargin) {
  return Math.ceil(fixedCosts / grossMargin);
}

/**
 * Parse numeric input with validation
 */
function parseNumber(input, fieldName) {
  const num = Number(input);
  if (isNaN(num)) {
    throw new Error(`Invalid ${fieldName}: "${input}" is not a valid number`);
  }
  return num;
}

/**
 * Format currency
 */
function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

/**
 * Format percentage
 */
function formatPercentage(value) {
  return (value * 100).toFixed(1) + '%';
}

// ============================================================================
// Fragility Test Calculation
// ============================================================================

/**
 * Perform fragility test
 */
function performFragilityTest(input) {
  const results = {
    input,
    calculations: {},
    tests: {},
    verdict: null,
    recommendations: []
  };

  // Calculate gross margin if ticket and cogs provided
  if (input.ticket !== undefined && input.cogs !== undefined) {
    results.calculations.grossMargin = calculateGrossMargin(input.ticket, input.cogs);
    results.calculations.grossMarginPercentage = ((results.calculations.grossMargin / input.ticket) * 100).toFixed(1) + '%';
  }

  // Calculate break-even if not provided
  if (input.breakEven === undefined && input.fixedCosts !== undefined && results.calculations.grossMargin !== undefined) {
    results.calculations.breakEven = calculateBreakEven(input.fixedCosts, results.calculations.grossMargin);
  } else {
    results.calculations.breakEven = input.breakEven;
  }

  // Parse SOM range
  const somRange = input.som !== undefined ? parseRange(input.som) : { min: 0, max: 0 };
  const breakEven = results.calculations.breakEven || input.breakEven || 0;

  // Fragility test (using optimistic SOM)
  results.tests.fragility = {
    breakEven,
    somOptimista: somRange.max,
    ratio: somRange.max > 0 ? breakEven / somRange.max : 0,
    verdict: somRange.max > 0 && breakEven / somRange.max <= 0.5 ? 'STRONG' : 'FRAGILE'
  };

  // Fragility test (using realistic SOM - midpoint)
  const somMidpoint = (somRange.min + somRange.max) / 2;
  results.tests.fragilityRealista = {
    breakEven,
    somRealista: somMidpoint,
    ratio: somMidpoint > 0 ? breakEven / somMidpoint : 0,
    verdict: somMidpoint > 0 && breakEven / somMidpoint <= 0.5 ? 'STRONG' : 'FRAGILE'
  };

  // Overall verdict
  if (results.tests.fragility.verdict === 'STRONG' && results.tests.fragilityRealista.verdict === 'STRONG') {
    results.verdict = 'STRONG';
    results.recommendations.push('Model passes fragility test. Proceed with confidence.');
  } else if (results.tests.fragility.verdict === 'FRAGILE' && results.tests.fragilityRealista.verdict === 'FRAGILE') {
    results.verdict = 'FRAGILE';
    results.recommendations.push('Model is structurally fragile. Do NOT proceed without fundamental changes.');
    results.recommendations.push('Consider: expanding TAM, increasing ticket, reducing costs, finding channel partners.');
  } else {
    results.verdict = 'MARGINAL';
    results.recommendations.push('Model is marginal. Proceed with caution and address concerns.');
  }

  // Additional recommendations based on ratios
  if (results.tests.fragility.ratio > 0.7) {
    results.recommendations.push('CRITICAL: Break-even consumes >70% of optimistic SOM. High risk of failure.');
  } else if (results.tests.fragility.ratio > 0.5) {
    results.recommendations.push('WARNING: Break-even consumes >50% of optimistic SOM. Model is fragile.');
  }

  // Unit economics recommendations
  if (input.ticket !== undefined && input.cogs !== undefined) {
    const marginPct = results.calculations.grossMargin / input.ticket;
    if (marginPct < 0.4) {
      results.recommendations.push('WARNING: Gross margin <40%. Consider reducing COGS or increasing ticket.');
    } else if (marginPct > 0.7) {
      results.recommendations.push('Gross margin >70% is excellent. Good pricing power.');
    }
  }

  return results;
}

// ============================================================================
// Display Results
// ============================================================================

/**
 * Display results in a formatted way
 */
function displayResults(results) {
  console.log('\n' + '='.repeat(70));
  console.log('FRAGILITY TEST RESULTS');
  console.log('='.repeat(70) + '\n');

  // Input summary
  console.log('INPUT SUMMARY:');
  console.log('-'.repeat(70));
  
  if (results.input.tam !== undefined) {
    const tamRange = parseRange(results.input.tam);
    console.log(`  TAM:       ${tamRange.min}–${tamRange.max} ${results.input.tamUnit || ''}`);
  }
  if (results.input.sam !== undefined) {
    const samRange = parseRange(results.input.sam);
    console.log(`  SAM:       ${samRange.min}–${samRange.max} ${results.input.samUnit || ''}`);
  }
  if (results.input.som !== undefined) {
    const somRange = parseRange(results.input.som);
    console.log(`  SOM:       ${somRange.min}–${somRange.max} ${results.input.somUnit || ''}`);
  }
  if (results.input.breakEven !== undefined) {
    console.log(`  Break-Even: ${results.input.breakEven} clients`);
  }
  if (results.input.ticket !== undefined) {
    console.log(`  Ticket:    ${formatCurrency(results.input.ticket)}/month`);
  }
  if (results.input.cogs !== undefined) {
    console.log(`  COGS:      ${formatCurrency(results.input.cogs)}/month`);
  }
  if (results.input.fixedCosts !== undefined) {
    console.log(`  Fixed Costs: ${formatCurrency(results.input.fixedCosts)}/month`);
  }
  
  console.log('\n');

  // Calculations
  if (results.calculations.grossMargin !== undefined) {
    console.log('CALCULATIONS:');
    console.log('-'.repeat(70));
    console.log(`  Gross Margin: ${formatCurrency(results.calculations.grossMargin)}/month (${results.calculations.grossMarginPercentage})`);
    if (results.calculations.breakEven !== undefined) {
      console.log(`  Break-Even:   ${results.calculations.breakEven} clients`);
    }
    console.log('\n');
  }

  // Fragility test results
  console.log('FRAGILITY TEST:');
  console.log('-'.repeat(70));
  
  console.log(`\n  Using Optimistic SOM (${results.tests.fragility.somOptimista}):`);
  console.log(`    Break-Even: ${results.tests.fragility.breakEven} clients`);
  console.log(`    Ratio:      ${formatPercentage(results.tests.fragility.ratio)}`);
  console.log(`    Verdict:    ${results.tests.fragility.verdict}`);
  
  console.log(`\n  Using Realistic SOM (${Math.round(results.tests.fragilityRealista.somRealista)}):`);
  console.log(`    Break-Even: ${results.tests.fragilityRealista.breakEven} clients`);
  console.log(`    Ratio:      ${formatPercentage(results.tests.fragilityRealista.ratio)}`);
  console.log(`    Verdict:    ${results.tests.fragilityRealista.verdict}`);

  console.log('\n');

  // Overall verdict
  console.log('OVERALL VERDICT:');
  console.log('-'.repeat(70));
  
  const verdictEmoji = {
    STRONG: '✅',
    MARGINAL: '⚠️',
    FRAGILE: '❌'
  };
  
  console.log(`  ${verdictEmoji[results.verdict] || '❓'} ${results.verdict}`);
  console.log('\n');

  // Recommendations
  console.log('RECOMMENDATIONS:');
  console.log('-'.repeat(70));
  results.recommendations.forEach((rec, index) => {
    console.log(`  ${index + 1}. ${rec}`);
  });
  
  console.log('\n' + '='.repeat(70) + '\n');
}

// ============================================================================
// Interactive Mode
// ============================================================================

/**
 * Run in interactive mode
 */
async function runInteractive() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n' + '='.repeat(70));
  console.log('FRAGILITY TEST - Interactive Mode');
  console.log('='.repeat(70));
  console.log('\nAnswer the following questions to perform a fragility test.\n');

  const input = {};

  // TAM
  input.tam = await askQuestion(rl, 'TAM (Total Addressable Market) [range, e.g., "180-250"]: ');
  input.tamUnit = await askQuestion(rl, 'TAM unit [e.g., "agencies", "businesses"]: ');

  // SAM
  input.sam = await askQuestion(rl, 'SAM (Serviceable Available Market) [range, e.g., "45-90"]: ');
  input.samUnit = await askQuestion(rl, 'SAM unit [e.g., "agencies"]: ');

  // SOM
  input.som = await askQuestion(rl, 'SOM Year 1 (Serviceable Obtainable Market) [range, e.g., "9-27"]: ');
  input.somUnit = await askQuestion(rl, 'SOM unit [e.g., "agencies"]: ');

  // Break-even (optional)
  const breakEvenInput = await askQuestion(rl, 'Break-even clients [number, leave empty to calculate]: ');
  if (breakEvenInput) {
    input.breakEven = parseNumber(breakEvenInput, 'break-even');
  }

  // Ticket (optional, for calculation)
  const ticketInput = await askQuestion(rl, 'Monthly ticket price [USD, leave empty if unknown]: ');
  if (ticketInput) {
    input.ticket = parseNumber(ticketInput, 'ticket');
  }

  // COGS (optional, for calculation)
  const cogsInput = await askQuestion(rl, 'COGS per client [USD, leave empty if unknown]: ');
  if (cogsInput) {
    input.cogs = parseNumber(cogsInput, 'COGS');
  }

  // Fixed costs (optional, for calculation)
  const fixedCostsInput = await askQuestion(rl, 'Monthly fixed costs [USD, leave empty if unknown]: ');
  if (fixedCostsInput) {
    input.fixedCosts = parseNumber(fixedCostsInput, 'fixed costs');
  }

  rl.close();

  // Perform test
  const results = performFragilityTest(input);
  displayResults(results);
}

/**
 * Ask a question in interactive mode
 */
function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// ============================================================================
// Main
// ============================================================================

/**
 * Parse command-line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('--interactive') || args.includes('-i')) {
    return { interactive: true };
  }

  const input = {};
  let i = 0;
  
  while (i < args.length) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-/g, '_');
      const value = args[i + 1];
      
      if (value && !value.startsWith('--')) {
        input[key] = value;
        i += 2;
      } else {
        input[key] = true;
        i += 1;
      }
    } else {
      i += 1;
    }
  }

  return { input, interactive: false };
}

/**
 * Show help
 */
function showHelp() {
  console.log(`
Fragility Test Tool - Business Viability Framework

Usage:
  node scripts/fragility-test.js [options]
  node scripts/fragility-test.js --interactive

Options:
  --tam <value>        TAM value or range (e.g., "180-250")
  --sam <value>        SAM value or range (e.g., "45-90")
  --som <value>        SOM value or range (e.g., "9-27")
  --break-even <value> Break-even clients (e.g., "17")
  --ticket <value>      Monthly ticket price (e.g., "300")
  --cogs <value>        Cost of goods sold per client (e.g., "150")
  --fixed-costs <value> Monthly fixed costs (e.g., "2500")
  --interactive         Run in interactive mode
  --help, -h            Show this help

Examples:
  node scripts/fragility-test.js --tam "180-250" --sam "45-90" --som "9-27" --break-even 17
  node scripts/fragility-test.js --ticket 300 --cogs 150 --fixed-costs 2500
  node scripts/fragility-test.js --interactive

Description:
  Performs a fragility test on a business model by comparing break-even
  clients to the Serviceable Obtainable Market (SOM).
  
  Rule: If break-even > 50% of SOM (optimistic), the model is FRAGILE.
  
  This is part of the Business Viability Framework for venture-as-code.
`);
}

// ============================================================================
// Entry Point
// ============================================================================

try {
  const { input, interactive } = parseArguments();
  
  if (interactive) {
    runInteractive().catch(console.error);
  } else {
    const results = performFragilityTest(input);
    displayResults(results);
  }
} catch (error) {
  console.error('Error:', error.message);
  console.error('\nUse --help for usage information.');
  process.exit(1);
}
