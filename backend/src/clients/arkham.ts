import { config } from '../config/index.js';

interface ArkhamEntity {
    address: string;
    name?: string;
    type?: string;
    isTagged: boolean;
    labels: string[];
    riskScore?: number;
}

/**
 * Optional client for Arkham Intel entity tagging
 * Provides additional context for wallet analysis
 */
export class ArkhamClient {
    private readonly apiKey: string;
    private readonly baseUrl = 'https://api.arkhamintelligence.com/v1';
    private readonly enabled: boolean;

    constructor(apiKey?: string) {
        this.apiKey = apiKey || config.arkhamApiKey;
        this.enabled = Boolean(this.apiKey);
    }

    /**
     * Check if Arkham integration is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Get entity information for an address
     */
    async getEntity(address: string): Promise<ArkhamEntity | null> {
        if (!this.enabled) {
            return null;
        }

        try {
            const response = await fetch(
                `${this.baseUrl}/address/${address}`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (!response.ok) {
                if (response.status === 404) {
                    // Address not found in Arkham database
                    return {
                        address,
                        isTagged: false,
                        labels: [],
                    };
                }
                throw new Error(`Arkham API error: ${response.status}`);
            }

            const data = await response.json() as {
                address: string;
                arkhamEntity?: {
                    name: string;
                    type: string;
                };
                labels?: string[];
                riskScore?: number;
            };

            return {
                address: data.address,
                name: data.arkhamEntity?.name,
                type: data.arkhamEntity?.type,
                isTagged: Boolean(data.arkhamEntity),
                labels: data.labels || [],
                riskScore: data.riskScore,
            };
        } catch (error) {
            console.error(`[Arkham] Error fetching entity for ${address}:`, error);
            return null;
        }
    }

    /**
     * Check if address is associated with known entities
     */
    async isKnownEntity(address: string): Promise<boolean> {
        const entity = await this.getEntity(address);
        return entity?.isTagged ?? false;
    }

    /**
     * Get risk assessment for an address
     */
    async getRiskScore(address: string): Promise<number> {
        const entity = await this.getEntity(address);
        return entity?.riskScore ?? 0;
    }
}
