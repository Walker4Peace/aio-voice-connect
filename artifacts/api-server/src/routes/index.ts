import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import clientsRouter from "./clients.js";
import extensionsRouter from "./extensions.js";
import agentConfigsRouter from "./agentConfigs.js";
import statsRouter from "./stats.js";
import deployRouter from "./deploy.js";
import setupRouter from "./setup.js";
import authRouter from "./auth.js";
import settingsRouter from "./settings.js";

const router: IRouter = Router();

router.use(authRouter);
router.use(setupRouter);
router.use(settingsRouter);
router.use(healthRouter);
router.use(clientsRouter);
router.use(extensionsRouter);
router.use(agentConfigsRouter);
router.use(statsRouter);
router.use(deployRouter);

export default router;
