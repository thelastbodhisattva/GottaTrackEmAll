/**
 * Scoring Factors Index
 * Re-exports all scoring factor functions
 */

export { scoreWalletAge } from './walletFactor.js';
export { scoreTradeSize, scoreImpact } from './tradeFactor.js';
export { scoreTiming } from './timingFactor.js';
export { scoreDiversification, detectCrossMarketCorrelation } from './diversificationFactor.js';
export { scoreOnChainSource } from './onChainFactor.js';
export { scoreSpecificity } from './specificityFactor.js';
export { scoreConnections, countFlaggedConnections } from './connectionsFactor.js';
export { scoreTradeVelocity } from './velocityFactor.js';
export { scoreEventProximity } from './proximityFactor.js';

