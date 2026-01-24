import { Router, Request, Response } from 'express';
import { WatchlistService, CreateWatchlistDTO, UpdateWatchlistDTO } from '../services/watchlistService.js';

const router = Router();
const watchlistService = new WatchlistService();

/**
 * @swagger
 * /api/watchlists:
 *   get:
 *     summary: Get all watchlists
 *     tags: [Watchlists]
 *     responses:
 *       200:
 *         description: List of all watchlists
 */
router.get('/', async (_req: Request, res: Response) => {
    try {
        const watchlists = await watchlistService.getAll();
        res.json(watchlists);
    } catch (error) {
        console.error('[WatchlistRoutes] Error fetching watchlists:', error);
        res.status(500).json({ error: 'Failed to fetch watchlists' });
    }
});

/**
 * @swagger
 * /api/watchlists/stats:
 *   get:
 *     summary: Get watchlist statistics
 *     tags: [Watchlists]
 */
router.get('/stats', async (_req: Request, res: Response) => {
    try {
        const stats = await watchlistService.getStats();
        res.json(stats);
    } catch (error) {
        console.error('[WatchlistRoutes] Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

/**
 * @swagger
 * /api/watchlists/{id}:
 *   get:
 *     summary: Get a single watchlist by ID
 *     tags: [Watchlists]
 */
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const watchlist = await watchlistService.getById(req.params.id);
        if (!watchlist) {
            res.status(404).json({ error: 'Watchlist not found' });
            return;
        }
        res.json(watchlist);
    } catch (error) {
        console.error('[WatchlistRoutes] Error fetching watchlist:', error);
        res.status(500).json({ error: 'Failed to fetch watchlist' });
    }
});

/**
 * @swagger
 * /api/watchlists:
 *   post:
 *     summary: Create a new watchlist
 *     tags: [Watchlists]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, wallets]
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               wallets:
 *                 type: array
 *                 items:
 *                   type: string
 *               alertConfig:
 *                 type: object
 *                 properties:
 *                   minTradeSize:
 *                     type: number
 *                     default: 100000
 *                   minScore:
 *                     type: number
 *                     default: 0
 *                   categories:
 *                     type: array
 *                     items:
 *                       type: string
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const data: CreateWatchlistDTO = req.body;

        // Validation
        if (!data.name || !data.name.trim()) {
            res.status(400).json({ error: 'Name is required' });
            return;
        }
        if (!data.wallets || !Array.isArray(data.wallets) || data.wallets.length === 0) {
            res.status(400).json({ error: 'At least one wallet address is required' });
            return;
        }

        // Validate wallet addresses (basic hex check)
        const invalidWallets = data.wallets.filter(w => !/^0x[a-fA-F0-9]{40}$/.test(w));
        if (invalidWallets.length > 0) {
            res.status(400).json({
                error: 'Invalid wallet addresses',
                invalidWallets
            });
            return;
        }

        // Validate minTradeSize if provided
        if (data.alertConfig?.minTradeSize !== undefined) {
            if (data.alertConfig.minTradeSize < 1000) {
                res.status(400).json({ error: 'Minimum trade size must be at least $1,000' });
                return;
            }
        }

        const watchlist = await watchlistService.create(data);
        res.status(201).json(watchlist);
    } catch (error) {
        console.error('[WatchlistRoutes] Error creating watchlist:', error);
        res.status(500).json({ error: 'Failed to create watchlist' });
    }
});

/**
 * @swagger
 * /api/watchlists/{id}:
 *   put:
 *     summary: Update a watchlist
 *     tags: [Watchlists]
 */
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const data: UpdateWatchlistDTO = req.body;

        // Validate wallet addresses if provided
        if (data.wallets) {
            const invalidWallets = data.wallets.filter(w => !/^0x[a-fA-F0-9]{40}$/.test(w));
            if (invalidWallets.length > 0) {
                res.status(400).json({
                    error: 'Invalid wallet addresses',
                    invalidWallets
                });
                return;
            }
        }

        const watchlist = await watchlistService.update(req.params.id, data);
        if (!watchlist) {
            res.status(404).json({ error: 'Watchlist not found' });
            return;
        }
        res.json(watchlist);
    } catch (error) {
        console.error('[WatchlistRoutes] Error updating watchlist:', error);
        res.status(500).json({ error: 'Failed to update watchlist' });
    }
});

/**
 * @swagger
 * /api/watchlists/{id}:
 *   delete:
 *     summary: Delete a watchlist
 *     tags: [Watchlists]
 */
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const deleted = await watchlistService.delete(req.params.id);
        if (!deleted) {
            res.status(404).json({ error: 'Watchlist not found' });
            return;
        }
        res.status(204).send();
    } catch (error) {
        console.error('[WatchlistRoutes] Error deleting watchlist:', error);
        res.status(500).json({ error: 'Failed to delete watchlist' });
    }
});

/**
 * @swagger
 * /api/watchlists/{id}/wallets:
 *   post:
 *     summary: Add wallets to a watchlist
 *     tags: [Watchlists]
 */
router.post('/:id/wallets', async (req: Request, res: Response) => {
    try {
        const { wallets } = req.body;

        if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
            res.status(400).json({ error: 'Wallets array is required' });
            return;
        }

        const invalidWallets = wallets.filter((w: string) => !/^0x[a-fA-F0-9]{40}$/.test(w));
        if (invalidWallets.length > 0) {
            res.status(400).json({ error: 'Invalid wallet addresses', invalidWallets });
            return;
        }

        const watchlist = await watchlistService.addWallets(req.params.id, wallets);
        if (!watchlist) {
            res.status(404).json({ error: 'Watchlist not found' });
            return;
        }
        res.json(watchlist);
    } catch (error) {
        console.error('[WatchlistRoutes] Error adding wallets:', error);
        res.status(500).json({ error: 'Failed to add wallets' });
    }
});

/**
 * @swagger
 * /api/watchlists/{id}/wallets:
 *   delete:
 *     summary: Remove wallets from a watchlist
 *     tags: [Watchlists]
 */
router.delete('/:id/wallets', async (req: Request, res: Response) => {
    try {
        const { wallets } = req.body;

        if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
            res.status(400).json({ error: 'Wallets array is required' });
            return;
        }

        const watchlist = await watchlistService.removeWallets(req.params.id, wallets);
        if (!watchlist) {
            res.status(404).json({ error: 'Watchlist not found' });
            return;
        }
        res.json(watchlist);
    } catch (error) {
        console.error('[WatchlistRoutes] Error removing wallets:', error);
        res.status(500).json({ error: 'Failed to remove wallets' });
    }
});

export { router as watchlistRouter };
