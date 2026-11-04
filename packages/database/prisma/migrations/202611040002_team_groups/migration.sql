CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMember" (
    "orgId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId", "membershipId")
);

CREATE UNIQUE INDEX "Team_orgId_normalizedName_key" ON "Team"("orgId", "normalizedName");
CREATE UNIQUE INDEX "Team_id_orgId_key" ON "Team"("id", "orgId");
CREATE INDEX "TeamMember_membershipId_orgId_idx" ON "TeamMember"("membershipId", "orgId");

ALTER TABLE "Team" ADD CONSTRAINT "Team_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_orgId_fkey" FOREIGN KEY ("teamId", "orgId") REFERENCES "Team"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_membershipId_orgId_fkey" FOREIGN KEY ("membershipId", "orgId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;
