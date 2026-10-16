import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemberRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { InvitationConfig } from '../../config/invitation-environment';
import { TenantAccessService } from '../memberships/tenant-access.service';
import { AuthClock } from '../auth/auth-clock.service';
import { VerificationTokenService } from '../auth/verification-token.service';
import { EmailService } from '../email/email.service';
import { SecurityEvents } from '../audit/security-events.service';
import {
  IssueInvitationDto,
  publicInvitationSelect,
} from './dto/invitation.dto';

const memberSelect = {
  organizationId: true,
  userId: true,
  role: true,
  status: true,
  joinedAt: true,
} satisfies Prisma.OrganizationMemberSelect;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TenantAccessService,
    private readonly tokens: VerificationTokenService,
    private readonly clock: AuthClock,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly events: SecurityEvents,
  ) {}
  private assertCanInvite(actorRole: MemberRole, invitedRole: MemberRole) {
    if (
      invitedRole === 'OWNER' ||
      (actorRole !== 'OWNER' &&
        !(actorRole === 'ADMIN' && invitedRole === 'MEMBER'))
    )
      throw new ForbiddenException();
  }
  async issue(
    userId: string,
    organizationId: string,
    input: IssueInvitationDto,
  ) {
    const email = input.email.trim().toLowerCase(),
      role = input.role ?? 'MEMBER',
      raw = this.tokens.create();
    const invitation = await this.prisma.$transaction(async (tx) => {
      await this.access.lockOrganization(tx, organizationId);
      const actor = await this.access.requireMember(
        tx,
        organizationId,
        userId,
        ['OWNER', 'ADMIN'],
      );
      this.assertCanInvite(actor.role, role);
      const member = await tx.organizationMember.findFirst({
        where: { organizationId, user: { email } },
        select: { status: true },
      });
      if (member?.status === 'SUSPENDED') throw new ForbiddenException();
      if (member?.status === 'ACTIVE') throw new ConflictException();
      const now = this.clock.now();
      const recent = await tx.invitation.findFirst({
        where: {
          organizationId,
          email,
          createdAt: { gt: new Date(now.getTime() - 60000) },
        },
        select: { id: true },
      });
      if (recent) throw new ConflictException();
      const prior = await tx.invitation.findMany({
        where: { organizationId, email, status: 'PENDING' },
        select: { id: true, role: true },
      });
      // ADMIN cannot indirectly revoke an owner's ADMIN invitation by reissuing.
      for (const previous of prior)
        this.assertCanInvite(actor.role, previous.role);
      await tx.invitation.updateMany({
        where: { organizationId, email, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      for (const previous of prior)
        await tx.auditLog.create({
          data: {
            organizationId,
            actorUserId: userId,
            action: 'invitation.revoked',
            resourceType: 'Invitation',
            resourceId: previous.id,
            metadata: { reason: 'reissued' },
          },
        });
      const created = await tx.invitation.create({
        data: {
          organizationId,
          email,
          role,
          invitedById: userId,
          tokenHash: this.tokens.hash(raw),
          createdAt: now,
          expiresAt: new Date(
            now.getTime() +
              this.config.getOrThrow<InvitationConfig>('INVITATIONS')
                .ttlSeconds *
                1000,
          ),
        },
        select: publicInvitationSelect,
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId: userId,
          action: 'invitation.issued',
          resourceType: 'Invitation',
          resourceId: created.id,
          metadata: { role },
        },
      });
      return created;
    });
    try {
      return {
        invitation,
        emailDelivery: await this.email.sendInvitation(
          email,
          raw,
          invitation.expiresAt,
        ),
      };
    } catch {
      this.events.record('invitation.delivery_failed', userId);
      return { invitation, emailDelivery: 'failed' as const };
    }
  }
  async revoke(userId: string, organizationId: string, invitationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lockOrganization(tx, organizationId);
      const actor = await this.access.requireMember(
        tx,
        organizationId,
        userId,
        ['OWNER', 'ADMIN'],
      );
      const invitation = await tx.invitation.findFirst({
        where: { id: invitationId, organizationId },
        select: publicInvitationSelect,
      });
      if (!invitation) throw new NotFoundException();
      this.assertCanInvite(actor.role, invitation.role);
      if (invitation.status === 'REVOKED') return invitation;
      if (invitation.status !== 'PENDING') throw new ConflictException();
      const revoked = await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'REVOKED' },
        select: publicInvitationSelect,
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId: userId,
          action: 'invitation.revoked',
          resourceType: 'Invitation',
          resourceId: invitation.id,
        },
      });
      return revoked;
    });
  }
  async accept(userId: string, raw: string) {
    const tokenHash = this.tokens.hash(raw);
    const found = await this.prisma.invitation.findUnique({
      where: { tokenHash },
      select: { organizationId: true },
    });
    if (!found) throw new BadRequestException();
    return this.prisma.$transaction(async (tx) => {
      await this.access.lockOrganization(tx, found.organizationId);
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash },
      });
      const user = await tx.user.findFirst({
        where: { id: userId, status: 'ACTIVE', emailVerifiedAt: { not: null } },
        select: { email: true },
      });
      const now = this.clock.now();
      if (!invitation || !user || user.email !== invitation.email)
        throw new BadRequestException();
      if (invitation.status === 'ACCEPTED') throw new ConflictException();
      if (invitation.status !== 'PENDING' || invitation.expiresAt <= now)
        throw new BadRequestException();
      const inviter = await this.access.requireMember(
        tx,
        invitation.organizationId,
        invitation.invitedById,
        ['OWNER', 'ADMIN'],
      );
      this.assertCanInvite(inviter.role, invitation.role);
      const existing = await tx.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId,
          },
        },
      });
      if (existing?.status === 'SUSPENDED') throw new ForbiddenException();
      if (existing?.status === 'ACTIVE') throw new ConflictException();
      const consumed = await tx.invitation.updateMany({
        where: { id: invitation.id, status: 'PENDING', expiresAt: { gt: now } },
        data: { status: 'ACCEPTED', acceptedAt: now },
      });
      if (consumed.count !== 1) throw new ConflictException();
      const member = await tx.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId,
          },
        },
        create: {
          organizationId: invitation.organizationId,
          userId,
          role: invitation.role,
          status: 'ACTIVE',
          joinedAt: now,
        },
        update: { role: invitation.role, status: 'ACTIVE', joinedAt: now },
        select: memberSelect,
      });
      await tx.auditLog.create({
        data: {
          organizationId: invitation.organizationId,
          actorUserId: userId,
          action: 'invitation.accepted',
          resourceType: 'Invitation',
          resourceId: invitation.id,
          metadata: { role: member.role },
        },
      });
      return member;
    });
  }
}
