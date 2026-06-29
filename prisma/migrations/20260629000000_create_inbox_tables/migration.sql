-- CreateTable: activity
CREATE TABLE "activity" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "actor_id" UUID,
    "source_doc_id" TEXT NOT NULL,
    "source_workspace_id" UUID NOT NULL,
    "source_note_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "deep_link" JSONB NOT NULL,
    "snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable: activity_target
CREATE TABLE "activity_target" (
    "activity_id" UUID NOT NULL,
    "user_id" UUID NOT NULL
);

-- CreateTable: activity_read
CREATE TABLE "activity_read" (
    "user_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3)
);

-- CreateTable: entity_reference
CREATE TABLE "entity_reference" (
    "id" UUID NOT NULL,
    "source_doc_id" TEXT NOT NULL,
    "source_workspace_id" UUID NOT NULL,
    "source_note_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable: assignment_index
CREATE TABLE "assignment_index" (
    "source_doc_id" TEXT NOT NULL,
    "checklist_item_id" TEXT NOT NULL,
    "assigned_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "activity_source_doc_id_idx" ON "activity"("source_doc_id");
CREATE INDEX "activity_created_at_idx" ON "activity"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "activity_target_activity_id_user_id_key" ON "activity_target"("activity_id", "user_id");
CREATE INDEX "activity_target_user_id_idx" ON "activity_target"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_read_user_id_activity_id_key" ON "activity_read"("user_id", "activity_id");
CREATE INDEX "activity_read_user_id_archived_idx" ON "activity_read"("user_id", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "entity_reference_source_doc_id_node_id_key" ON "entity_reference"("source_doc_id", "node_id");
CREATE INDEX "entity_reference_target_type_target_id_idx" ON "entity_reference"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_index_source_doc_id_checklist_item_id_assigned_user_id_key" ON "assignment_index"("source_doc_id", "checklist_item_id", "assigned_user_id");
CREATE INDEX "assignment_index_assigned_user_id_idx" ON "assignment_index"("assigned_user_id");

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_target" ADD CONSTRAINT "activity_target_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_target" ADD CONSTRAINT "activity_target_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_read" ADD CONSTRAINT "activity_read_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_read" ADD CONSTRAINT "activity_read_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
