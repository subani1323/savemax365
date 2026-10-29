/** Round a number to 2 decimal places (money-safe). */
export function roundTo2(num) {
    const n = Number(num);
    if (Number.isNaN(n)) return 0;
    return Math.round(n * 100) / 100;
  }
  
  /** Same as roundTo2, returned as a fixed two-decimal string. */
  export function roundTo2Str(num) {
    return roundTo2(num).toFixed(2);
  }
  