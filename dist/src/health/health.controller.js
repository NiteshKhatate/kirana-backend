"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const error_response_dto_1 = require("../common/http/error-response.dto");
const swagger_1 = require("@nestjs/swagger");
class ReadinessResponse {
}
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'ok' }),
    __metadata("design:type", String)
], ReadinessResponse.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'connected' }),
    __metadata("design:type", String)
], ReadinessResponse.prototype, "database", void 0);
class LivenessResponse {
}
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'ok' }),
    __metadata("design:type", String)
], LivenessResponse.prototype, "status", void 0);
let HealthController = class HealthController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async check() {
        try {
            await this.prisma.$queryRaw `SELECT 1`;
            return {
                status: 'ok',
                database: 'connected',
            };
        }
        catch {
            throw new common_1.ServiceUnavailableException('Database unavailable');
        }
    }
    live() {
        return { status: 'ok' };
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOkResponse)({ type: ReadinessResponse }),
    (0, swagger_1.ApiServiceUnavailableResponse)({
        description: 'Database is unavailable',
        type: error_response_dto_1.ErrorResponseDto,
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "check", null);
__decorate([
    (0, common_1.Get)('live'),
    (0, swagger_1.ApiOkResponse)({ type: LivenessResponse }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "live", null);
exports.HealthController = HealthController = __decorate([
    (0, swagger_1.ApiTags)('Health'),
    (0, common_1.Controller)('health'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], HealthController);
//# sourceMappingURL=health.controller.js.map