"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const config_1 = require("@nestjs/config");
const app_module_1 = require("./app.module");
const configure_app_1 = require("./configure-app");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { abortOnError: false });
    (0, configure_app_1.configureApp)(app);
    app.enableShutdownHooks();
    await app.listen(app.get(config_1.ConfigService).getOrThrow('PORT'), '0.0.0.0');
}
void bootstrap().catch(() => {
    console.error('Backend startup failed; check configuration and database availability.');
    process.exitCode = 1;
});
//# sourceMappingURL=main.js.map