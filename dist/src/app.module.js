"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const load_environment_1 = require("./config/load-environment");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_module_1 = require("./database/prisma.module");
const health_module_1 = require("./health/health.module");
const auth_module_1 = require("./modules/auth/auth.module");
const users_module_1 = require("./modules/users/users.module");
const organizations_module_1 = require("./modules/organizations/organizations.module");
const stores_module_1 = require("./modules/stores/stores.module");
const memberships_module_1 = require("./modules/memberships/memberships.module");
const onboarding_module_1 = require("./modules/onboarding/onboarding.module");
const invitations_module_1 = require("./modules/invitations/invitations.module");
const audit_module_1 = require("./modules/audit/audit.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot(load_environment_1.appConfigOptions),
            prisma_module_1.PrismaModule,
            health_module_1.HealthModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            organizations_module_1.OrganizationsModule,
            stores_module_1.StoresModule,
            memberships_module_1.MembershipsModule,
            onboarding_module_1.OnboardingModule,
            invitations_module_1.InvitationsModule,
            audit_module_1.AuditModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map