CREATE TABLE "reactions" (
	"session_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"place_id" text NOT NULL,
	"reaction" text,
	"room_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_session_id_user_id_place_id_pk" PRIMARY KEY("session_id","user_id","place_id"),
	CONSTRAINT "reactions_reaction_valid" CHECK ("reactions"."reaction" is null or "reactions"."reaction" in ('like', 'dislike'))
);
--> statement-breakpoint
CREATE TABLE "session_members" (
	"session_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_members_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "session_places" (
	"session_id" text NOT NULL,
	"place_id" text NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "session_places_session_id_place_id_pk" PRIMARY KEY("session_id","place_id"),
	CONSTRAINT "session_places_rank_nonnegative" CHECK ("session_places"."rank" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"host_id" uuid NOT NULL,
	"places_source" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "sessions_status_valid" CHECK ("sessions"."status" in ('open', 'ended')),
	CONSTRAINT "sessions_places_source_valid" CHECK ("sessions"."places_source" in ('sample', 'google')),
	CONSTRAINT "sessions_ended_at_matches_status" CHECK (("sessions"."status" = 'ended') = ("sessions"."ended_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_member_fk" FOREIGN KEY ("session_id","user_id") REFERENCES "public"."session_members"("session_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_place_fk" FOREIGN KEY ("session_id","place_id") REFERENCES "public"."session_places"("session_id","place_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_members" ADD CONSTRAINT "session_members_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_members" ADD CONSTRAINT "session_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_places" ADD CONSTRAINT "session_places_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;