// Generated from the Supabase staging schema after the four pinned RC
// hardening migrations were applied, then reconciled with the pending
// 20260712195500 sessions status contract. PostgreSQL's catalog does not
// expose NULL semantics for PL/pgSQL argument/result fields precisely. The
// nullable RPC fields below
// are deliberately widened to match their SQL bodies.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1";
  };
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string;
          admin_id: string | null;
          after: Json | null;
          before: Json | null;
          created_at: string | null;
          entity_id: string | null;
          entity_type: string;
          id: string;
        };
        Insert: {
          action: string;
          admin_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          created_at?: string | null;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
        };
        Update: {
          action?: string;
          admin_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          created_at?: string | null;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      bookable_slot_holds: {
        Row: {
          checkout_intent_id: string;
          close_reason: string | null;
          closed_at: string | null;
          created_at: string;
          expires_at: string;
          held_at: string;
          id: string;
          slot_id: string;
          status: string;
          subscription_id: string | null;
          updated_at: string;
        };
        Insert: {
          checkout_intent_id: string;
          close_reason?: string | null;
          closed_at?: string | null;
          created_at?: string;
          expires_at: string;
          held_at?: string;
          id?: string;
          slot_id: string;
          status?: string;
          subscription_id?: string | null;
          updated_at?: string;
        };
        Update: {
          checkout_intent_id?: string;
          close_reason?: string | null;
          closed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          held_at?: string;
          id?: string;
          slot_id?: string;
          status?: string;
          subscription_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookable_slot_holds_checkout_intent_id_fkey";
            columns: ["checkout_intent_id"];
            isOneToOne: false;
            referencedRelation: "checkout_intents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookable_slot_holds_slot_id_fkey";
            columns: ["slot_id"];
            isOneToOne: false;
            referencedRelation: "bookable_slots";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookable_slot_holds_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: true;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      bookable_slot_occurrences: {
        Row: {
          blocks_teacher: boolean;
          created_at: string;
          duration_minutes: number;
          occurrence_index: number;
          session_id: string | null;
          slot_id: string;
          starts_at: string;
          teacher_id: string;
          updated_at: string;
        };
        Insert: {
          blocks_teacher?: boolean;
          created_at?: string;
          duration_minutes?: number;
          occurrence_index: number;
          session_id?: string | null;
          slot_id: string;
          starts_at: string;
          teacher_id: string;
          updated_at?: string;
        };
        Update: {
          blocks_teacher?: boolean;
          created_at?: string;
          duration_minutes?: number;
          occurrence_index?: number;
          session_id?: string | null;
          slot_id?: string;
          starts_at?: string;
          teacher_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookable_slot_occurrences_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookable_slot_occurrences_slot_teacher_fkey";
            columns: ["slot_id", "teacher_id"];
            isOneToOne: false;
            referencedRelation: "bookable_slots";
            referencedColumns: ["id", "teacher_id"];
          },
        ];
      };
      bookable_slots: {
        Row: {
          capacity: number;
          contract_schema_version: number;
          created_at: string;
          created_by: string;
          first_occurrence_at: string;
          id: string;
          local_start_time: string;
          package_id: string;
          public_id: string;
          published_at: string | null;
          published_by: string | null;
          sessions_materialized_at: string | null;
          sold_at: string | null;
          sold_subscription_id: string | null;
          status: string;
          teacher_id: string;
          timezone_name: string;
          updated_at: string;
          weekday: number;
        };
        Insert: {
          capacity?: number;
          contract_schema_version?: number;
          created_at?: string;
          created_by: string;
          first_occurrence_at: string;
          id?: string;
          local_start_time: string;
          package_id: string;
          public_id?: string;
          published_at?: string | null;
          published_by?: string | null;
          sessions_materialized_at?: string | null;
          sold_at?: string | null;
          sold_subscription_id?: string | null;
          status?: string;
          teacher_id: string;
          timezone_name: string;
          updated_at?: string;
          weekday: number;
        };
        Update: {
          capacity?: number;
          contract_schema_version?: number;
          created_at?: string;
          created_by?: string;
          first_occurrence_at?: string;
          id?: string;
          local_start_time?: string;
          package_id?: string;
          public_id?: string;
          published_at?: string | null;
          published_by?: string | null;
          sessions_materialized_at?: string | null;
          sold_at?: string | null;
          sold_subscription_id?: string | null;
          status?: string;
          teacher_id?: string;
          timezone_name?: string;
          updated_at?: string;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: "bookable_slots_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookable_slots_package_contract_fkey";
            columns: ["package_id", "contract_schema_version"];
            isOneToOne: false;
            referencedRelation: "packages";
            referencedColumns: ["id", "contract_schema_version"];
          },
          {
            foreignKeyName: "bookable_slots_published_by_fkey";
            columns: ["published_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookable_slots_sold_subscription_id_fkey";
            columns: ["sold_subscription_id"];
            isOneToOne: true;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookable_slots_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      checkout_intents: {
        Row: {
          completed_at: string | null;
          contact_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          lang: string;
          legal_policy_version: string;
          opportunity_id: string;
          package_price_id: string;
          policy_accepted_at: string;
          site_url: string;
          status: string;
          stripe_checkout_session_id: string | null;
          stripe_customer_id: string | null;
          stripe_session_expires_at: string;
          student_id: string;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          contact_id: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          lang: string;
          legal_policy_version: string;
          opportunity_id: string;
          package_price_id: string;
          policy_accepted_at: string;
          site_url: string;
          status?: string;
          stripe_checkout_session_id?: string | null;
          stripe_customer_id?: string | null;
          stripe_session_expires_at: string;
          student_id: string;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          contact_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          lang?: string;
          legal_policy_version?: string;
          opportunity_id?: string;
          package_price_id?: string;
          policy_accepted_at?: string;
          site_url?: string;
          status?: string;
          stripe_checkout_session_id?: string | null;
          stripe_customer_id?: string | null;
          stripe_session_expires_at?: string;
          student_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "checkout_intents_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "crm_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_intents_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "crm_opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_intents_package_price_id_fkey";
            columns: ["package_price_id"];
            isOneToOne: false;
            referencedRelation: "package_prices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_intents_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_activities: {
        Row: {
          activity_type: string;
          actor_id: string | null;
          body: string | null;
          contact_id: string;
          created_at: string | null;
          id: string;
          metadata: Json;
          occurred_at: string;
          opportunity_id: string | null;
          related_entity_id: string | null;
          related_entity_type: string | null;
          subject: string | null;
        };
        Insert: {
          activity_type: string;
          actor_id?: string | null;
          body?: string | null;
          contact_id: string;
          created_at?: string | null;
          id?: string;
          metadata?: Json;
          occurred_at?: string;
          opportunity_id?: string | null;
          related_entity_id?: string | null;
          related_entity_type?: string | null;
          subject?: string | null;
        };
        Update: {
          activity_type?: string;
          actor_id?: string | null;
          body?: string | null;
          contact_id?: string;
          created_at?: string | null;
          id?: string;
          metadata?: Json;
          occurred_at?: string;
          opportunity_id?: string | null;
          related_entity_id?: string | null;
          related_entity_type?: string | null;
          subject?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_activities_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_activities_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "crm_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_activities_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "crm_opportunities";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_consents: {
        Row: {
          captured_at: string | null;
          channel: string;
          contact_id: string;
          created_at: string | null;
          id: string;
          legal_basis: string;
          notice_version: string | null;
          opted_out_at: string | null;
          proof: string | null;
          purpose: string;
          source: string | null;
          updated_at: string | null;
        };
        Insert: {
          captured_at?: string | null;
          channel: string;
          contact_id: string;
          created_at?: string | null;
          id?: string;
          legal_basis: string;
          notice_version?: string | null;
          opted_out_at?: string | null;
          proof?: string | null;
          purpose: string;
          source?: string | null;
          updated_at?: string | null;
        };
        Update: {
          captured_at?: string | null;
          channel?: string;
          contact_id?: string;
          created_at?: string | null;
          id?: string;
          legal_basis?: string;
          notice_version?: string | null;
          opted_out_at?: string | null;
          proof?: string | null;
          purpose?: string;
          source?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_consents_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "crm_contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_contacts: {
        Row: {
          country: string | null;
          created_at: string | null;
          full_name: string | null;
          id: string;
          last_contacted_at: string | null;
          lifecycle_stage: string;
          next_follow_up_at: string | null;
          owner_id: string | null;
          phone: string | null;
          preferred_language: string | null;
          primary_email: string;
          profile_id: string | null;
          source: string | null;
          source_path: string | null;
          timezone: string | null;
          updated_at: string | null;
        };
        Insert: {
          country?: string | null;
          created_at?: string | null;
          full_name?: string | null;
          id?: string;
          last_contacted_at?: string | null;
          lifecycle_stage?: string;
          next_follow_up_at?: string | null;
          owner_id?: string | null;
          phone?: string | null;
          preferred_language?: string | null;
          primary_email: string;
          profile_id?: string | null;
          source?: string | null;
          source_path?: string | null;
          timezone?: string | null;
          updated_at?: string | null;
        };
        Update: {
          country?: string | null;
          created_at?: string | null;
          full_name?: string | null;
          id?: string;
          last_contacted_at?: string | null;
          lifecycle_stage?: string;
          next_follow_up_at?: string | null;
          owner_id?: string | null;
          phone?: string | null;
          preferred_language?: string | null;
          primary_email?: string;
          profile_id?: string | null;
          source?: string | null;
          source_path?: string | null;
          timezone?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_contacts_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_contacts_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_opportunities: {
        Row: {
          assigned_to: string | null;
          availability: string | null;
          checkout_approved_at: string | null;
          closed_at: string | null;
          contact_id: string;
          converted_subscription_id: string | null;
          created_at: string | null;
          current_level: string | null;
          expected_value_cents: number | null;
          id: string;
          interest: string | null;
          learning_goal: string | null;
          legacy_lead_id: string | null;
          lost_reason: string | null;
          opened_at: string;
          preferred_package_id: string | null;
          probability_percent: number | null;
          stage: string;
          updated_at: string | null;
        };
        Insert: {
          assigned_to?: string | null;
          availability?: string | null;
          checkout_approved_at?: string | null;
          closed_at?: string | null;
          contact_id: string;
          converted_subscription_id?: string | null;
          created_at?: string | null;
          current_level?: string | null;
          expected_value_cents?: number | null;
          id?: string;
          interest?: string | null;
          learning_goal?: string | null;
          legacy_lead_id?: string | null;
          lost_reason?: string | null;
          opened_at?: string;
          preferred_package_id?: string | null;
          probability_percent?: number | null;
          stage?: string;
          updated_at?: string | null;
        };
        Update: {
          assigned_to?: string | null;
          availability?: string | null;
          checkout_approved_at?: string | null;
          closed_at?: string | null;
          contact_id?: string;
          converted_subscription_id?: string | null;
          created_at?: string | null;
          current_level?: string | null;
          expected_value_cents?: number | null;
          id?: string;
          interest?: string | null;
          learning_goal?: string | null;
          legacy_lead_id?: string | null;
          lost_reason?: string | null;
          opened_at?: string;
          preferred_package_id?: string | null;
          probability_percent?: number | null;
          stage?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_opportunities_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_opportunities_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "crm_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_opportunities_converted_subscription_id_fkey";
            columns: ["converted_subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_opportunities_legacy_lead_id_fkey";
            columns: ["legacy_lead_id"];
            isOneToOne: true;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_opportunities_preferred_package_id_fkey";
            columns: ["preferred_package_id"];
            isOneToOne: false;
            referencedRelation: "packages";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_tasks: {
        Row: {
          assigned_to: string | null;
          completed_at: string | null;
          contact_id: string;
          created_at: string | null;
          due_at: string | null;
          id: string;
          metadata: Json;
          opportunity_id: string | null;
          priority: string;
          related_entity_id: string | null;
          related_entity_type: string | null;
          status: string;
          task_type: string;
          title: string;
          updated_at: string | null;
        };
        Insert: {
          assigned_to?: string | null;
          completed_at?: string | null;
          contact_id: string;
          created_at?: string | null;
          due_at?: string | null;
          id?: string;
          metadata?: Json;
          opportunity_id?: string | null;
          priority?: string;
          related_entity_id?: string | null;
          related_entity_type?: string | null;
          status?: string;
          task_type?: string;
          title: string;
          updated_at?: string | null;
        };
        Update: {
          assigned_to?: string | null;
          completed_at?: string | null;
          contact_id?: string;
          created_at?: string | null;
          due_at?: string | null;
          id?: string;
          metadata?: Json;
          opportunity_id?: string | null;
          priority?: string;
          related_entity_id?: string | null;
          related_entity_type?: string | null;
          status?: string;
          task_type?: string;
          title?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_tasks_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_tasks_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "crm_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_tasks_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "crm_opportunities";
            referencedColumns: ["id"];
          },
        ];
      };
      email_recipient_budget_usage: {
        Row: {
          budget_scope: string;
          created_at: string;
          last_source: string;
          period_kind: string;
          period_start: string;
          recipient_count: number;
          updated_at: string;
        };
        Insert: {
          budget_scope: string;
          created_at?: string;
          last_source: string;
          period_kind: string;
          period_start: string;
          recipient_count?: number;
          updated_at?: string;
        };
        Update: {
          budget_scope?: string;
          created_at?: string;
          last_source?: string;
          period_kind?: string;
          period_start?: string;
          recipient_count?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      fulfillment_effects: {
        Row: {
          attempt_generation: number;
          completed_at: string | null;
          created_at: string;
          effect_key: string;
          effect_type: string;
          error: Json | null;
          first_attempt_at: string | null;
          id: string;
          job_id: string;
          last_attempt_at: string | null;
          lease_expires_at: string | null;
          lease_owner: string | null;
          payload_sha256: string;
          provider_id: string | null;
          result: Json | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempt_generation?: number;
          completed_at?: string | null;
          created_at?: string;
          effect_key: string;
          effect_type: string;
          error?: Json | null;
          first_attempt_at?: string | null;
          id?: string;
          job_id: string;
          last_attempt_at?: string | null;
          lease_expires_at?: string | null;
          lease_owner?: string | null;
          payload_sha256: string;
          provider_id?: string | null;
          result?: Json | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempt_generation?: number;
          completed_at?: string | null;
          created_at?: string;
          effect_key?: string;
          effect_type?: string;
          error?: Json | null;
          first_attempt_at?: string | null;
          id?: string;
          job_id?: string;
          last_attempt_at?: string | null;
          lease_expires_at?: string | null;
          lease_owner?: string | null;
          payload_sha256?: string;
          provider_id?: string | null;
          result?: Json | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fulfillment_effects_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "fulfillment_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      fulfillment_jobs: {
        Row: {
          attempts: number;
          created_at: string | null;
          dedupe_key: string | null;
          id: string;
          job_type: string;
          last_error: string | null;
          locked_at: string | null;
          locked_by: string | null;
          max_attempts: number;
          payload: Json;
          run_at: string;
          session_id: string | null;
          status: string;
          student_id: string | null;
          subscription_id: string | null;
          updated_at: string | null;
        };
        Insert: {
          attempts?: number;
          created_at?: string | null;
          dedupe_key?: string | null;
          id?: string;
          job_type: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          payload?: Json;
          run_at?: string;
          session_id?: string | null;
          status?: string;
          student_id?: string | null;
          subscription_id?: string | null;
          updated_at?: string | null;
        };
        Update: {
          attempts?: number;
          created_at?: string | null;
          dedupe_key?: string | null;
          id?: string;
          job_type?: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          payload?: Json;
          run_at?: string;
          session_id?: string | null;
          status?: string;
          student_id?: string | null;
          subscription_id?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "fulfillment_jobs_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fulfillment_jobs_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fulfillment_jobs_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      leads: {
        Row: {
          adult_confirmed: boolean;
          adult_confirmed_at: string | null;
          age_policy_version: string | null;
          availability: string | null;
          consent_given: boolean;
          created_at: string;
          crm_contact_id: string | null;
          crm_opportunity_id: string | null;
          current_level: string | null;
          email: string;
          id: string;
          interest: string | null;
          ip_address: string | null;
          is_russian_speaker: boolean;
          lang: string | null;
          learning_goal: string | null;
          level_check_confidence: string | null;
          level_check_context: Json;
          level_check_estimated_level: string | null;
          level_check_fit_flags: string[];
          level_check_plan_recommendation: string | null;
          level_check_raw_cleared_at: string | null;
          level_check_received_at: string | null;
          level_check_reviewed_at: string | null;
          level_check_status: string;
          level_check_summary: string | null;
          name: string | null;
          preferred_package: string | null;
          source_path: string | null;
          spoken_languages: string[];
          status: Database["public"]["Enums"]["lead_status"];
          updated_at: string | null;
        };
        Insert: {
          adult_confirmed?: boolean;
          adult_confirmed_at?: string | null;
          age_policy_version?: string | null;
          availability?: string | null;
          consent_given?: boolean;
          created_at?: string;
          crm_contact_id?: string | null;
          crm_opportunity_id?: string | null;
          current_level?: string | null;
          email: string;
          id?: string;
          interest?: string | null;
          ip_address?: string | null;
          is_russian_speaker?: boolean;
          lang?: string | null;
          learning_goal?: string | null;
          level_check_confidence?: string | null;
          level_check_context?: Json;
          level_check_estimated_level?: string | null;
          level_check_fit_flags?: string[];
          level_check_plan_recommendation?: string | null;
          level_check_raw_cleared_at?: string | null;
          level_check_received_at?: string | null;
          level_check_reviewed_at?: string | null;
          level_check_status?: string;
          level_check_summary?: string | null;
          name?: string | null;
          preferred_package?: string | null;
          source_path?: string | null;
          spoken_languages?: string[];
          status?: Database["public"]["Enums"]["lead_status"];
          updated_at?: string | null;
        };
        Update: {
          adult_confirmed?: boolean;
          adult_confirmed_at?: string | null;
          age_policy_version?: string | null;
          availability?: string | null;
          consent_given?: boolean;
          created_at?: string;
          crm_contact_id?: string | null;
          crm_opportunity_id?: string | null;
          current_level?: string | null;
          email?: string;
          id?: string;
          interest?: string | null;
          ip_address?: string | null;
          is_russian_speaker?: boolean;
          lang?: string | null;
          learning_goal?: string | null;
          level_check_confidence?: string | null;
          level_check_context?: Json;
          level_check_estimated_level?: string | null;
          level_check_fit_flags?: string[];
          level_check_plan_recommendation?: string | null;
          level_check_raw_cleared_at?: string | null;
          level_check_received_at?: string | null;
          level_check_reviewed_at?: string | null;
          level_check_status?: string;
          level_check_summary?: string | null;
          name?: string | null;
          preferred_package?: string | null;
          source_path?: string | null;
          spoken_languages?: string[];
          status?: Database["public"]["Enums"]["lead_status"];
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "leads_crm_contact_id_fkey";
            columns: ["crm_contact_id"];
            isOneToOne: false;
            referencedRelation: "crm_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_crm_opportunity_id_fkey";
            columns: ["crm_opportunity_id"];
            isOneToOne: false;
            referencedRelation: "crm_opportunities";
            referencedColumns: ["id"];
          },
        ];
      };
      package_prices: {
        Row: {
          activated_at: string;
          amount_cents: number;
          billing_interval_count: number | null;
          billing_interval_unit: string | null;
          catalog_version: number;
          class_duration_minutes: number | null;
          contract_schema_version: number;
          created_at: string;
          created_by: string | null;
          currency: string;
          display_name: Json;
          duration_months: number | null;
          has_dual_teacher: boolean;
          has_group_session: boolean;
          id: string;
          package_id: string;
          package_key: string;
          retired_at: string | null;
          sessions_per_month: number | null;
          sessions_per_period: number;
          status: string;
          stripe_account_id: string | null;
          stripe_livemode: boolean;
          stripe_price_id: string;
          stripe_product_id: string;
        };
        Insert: {
          activated_at?: string;
          amount_cents: number;
          billing_interval_count?: number | null;
          billing_interval_unit?: string | null;
          catalog_version: number;
          class_duration_minutes?: number | null;
          contract_schema_version?: number;
          created_at?: string;
          created_by?: string | null;
          currency: string;
          display_name: Json;
          duration_months?: number | null;
          has_dual_teacher?: boolean;
          has_group_session?: boolean;
          id?: string;
          package_id: string;
          package_key: string;
          retired_at?: string | null;
          sessions_per_month?: number | null;
          sessions_per_period: number;
          status: string;
          stripe_account_id?: string | null;
          stripe_livemode: boolean;
          stripe_price_id: string;
          stripe_product_id: string;
        };
        Update: {
          activated_at?: string;
          amount_cents?: number;
          billing_interval_count?: number | null;
          billing_interval_unit?: string | null;
          catalog_version?: number;
          class_duration_minutes?: number | null;
          contract_schema_version?: number;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          display_name?: Json;
          duration_months?: number | null;
          has_dual_teacher?: boolean;
          has_group_session?: boolean;
          id?: string;
          package_id?: string;
          package_key?: string;
          retired_at?: string | null;
          sessions_per_month?: number | null;
          sessions_per_period?: number;
          status?: string;
          stripe_account_id?: string | null;
          stripe_livemode?: boolean;
          stripe_price_id?: string;
          stripe_product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "package_prices_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "package_prices_package_contract_version_fkey";
            columns: ["package_id", "contract_schema_version"];
            isOneToOne: false;
            referencedRelation: "packages";
            referencedColumns: ["id", "contract_schema_version"];
          },
        ];
      };
      packages: {
        Row: {
          amount_cents: number | null;
          billing_interval_count: number | null;
          billing_interval_unit: string | null;
          catalog_version: number;
          class_duration_minutes: number | null;
          contract_schema_version: number;
          created_at: string | null;
          display_name: Json;
          has_dual_teacher: boolean | null;
          has_group_session: boolean | null;
          id: string;
          is_active: boolean | null;
          is_publicly_listed: boolean;
          name: string;
          price_monthly: number;
          sessions_per_month: number;
          sessions_per_period: number | null;
          stripe_price_1m: string | null;
          stripe_price_3m: string | null;
          stripe_price_6m: string | null;
          stripe_product_id: string | null;
          updated_at: string | null;
        };
        Insert: {
          amount_cents?: number | null;
          billing_interval_count?: number | null;
          billing_interval_unit?: string | null;
          catalog_version?: number;
          class_duration_minutes?: number | null;
          contract_schema_version?: number;
          created_at?: string | null;
          display_name: Json;
          has_dual_teacher?: boolean | null;
          has_group_session?: boolean | null;
          id?: string;
          is_active?: boolean | null;
          is_publicly_listed?: boolean;
          name: string;
          price_monthly: number;
          sessions_per_month: number;
          sessions_per_period?: number | null;
          stripe_price_1m?: string | null;
          stripe_price_3m?: string | null;
          stripe_price_6m?: string | null;
          stripe_product_id?: string | null;
          updated_at?: string | null;
        };
        Update: {
          amount_cents?: number | null;
          billing_interval_count?: number | null;
          billing_interval_unit?: string | null;
          catalog_version?: number;
          class_duration_minutes?: number | null;
          contract_schema_version?: number;
          created_at?: string | null;
          display_name?: Json;
          has_dual_teacher?: boolean | null;
          has_group_session?: boolean | null;
          id?: string;
          is_active?: boolean | null;
          is_publicly_listed?: boolean;
          name?: string;
          price_monthly?: number;
          sessions_per_month?: number;
          sessions_per_period?: number | null;
          stripe_price_1m?: string | null;
          stripe_price_3m?: string | null;
          stripe_price_6m?: string | null;
          stripe_product_id?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          amount: number;
          amount_refunded: number;
          created_at: string | null;
          currency: string | null;
          description: string | null;
          id: string;
          refunded_at: string | null;
          status: Database["public"]["Enums"]["payment_status"] | null;
          stripe_invoice_id: string | null;
          stripe_payment_intent_id: string | null;
          stripe_refund_id: string | null;
          student_id: string;
          subscription_id: string | null;
        };
        Insert: {
          amount: number;
          amount_refunded?: number;
          created_at?: string | null;
          currency?: string | null;
          description?: string | null;
          id?: string;
          refunded_at?: string | null;
          status?: Database["public"]["Enums"]["payment_status"] | null;
          stripe_invoice_id?: string | null;
          stripe_payment_intent_id?: string | null;
          stripe_refund_id?: string | null;
          student_id: string;
          subscription_id?: string | null;
        };
        Update: {
          amount?: number;
          amount_refunded?: number;
          created_at?: string | null;
          currency?: string | null;
          description?: string | null;
          id?: string;
          refunded_at?: string | null;
          status?: Database["public"]["Enums"]["payment_status"] | null;
          stripe_invoice_id?: string | null;
          stripe_payment_intent_id?: string | null;
          stripe_refund_id?: string | null;
          student_id?: string;
          subscription_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payments_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      processed_webhook_events: {
        Row: {
          created_at: string | null;
          event_type: string;
          processed_at: string | null;
          processing_error: string | null;
          processing_status: string;
          stripe_event_id: string;
        };
        Insert: {
          created_at?: string | null;
          event_type: string;
          processed_at?: string | null;
          processing_error?: string | null;
          processing_status?: string;
          stripe_event_id: string;
        };
        Update: {
          created_at?: string | null;
          event_type?: string;
          processed_at?: string | null;
          processing_error?: string | null;
          processing_status?: string;
          stripe_event_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          adult_confirmed: boolean;
          adult_confirmed_at: string | null;
          age_policy_version: string | null;
          created_at: string | null;
          email: string;
          full_name: string | null;
          id: string;
          phone: string | null;
          preferred_language: string | null;
          role: Database["public"]["Enums"]["user_role"] | null;
          timezone: string | null;
          updated_at: string | null;
        };
        Insert: {
          adult_confirmed?: boolean;
          adult_confirmed_at?: string | null;
          age_policy_version?: string | null;
          created_at?: string | null;
          email: string;
          full_name?: string | null;
          id: string;
          phone?: string | null;
          preferred_language?: string | null;
          role?: Database["public"]["Enums"]["user_role"] | null;
          timezone?: string | null;
          updated_at?: string | null;
        };
        Update: {
          adult_confirmed?: boolean;
          adult_confirmed_at?: string | null;
          age_policy_version?: string | null;
          created_at?: string | null;
          email?: string;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          preferred_language?: string | null;
          role?: Database["public"]["Enums"]["user_role"] | null;
          timezone?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      profiles_private: {
        Row: {
          created_at: string | null;
          current_level: string | null;
          drive_folder_id: string | null;
          drive_folder_url: string | null;
          google_account_email: string | null;
          notes: string | null;
          profile_id: string;
          stripe_customer_account_id: string | null;
          stripe_customer_id: string | null;
          stripe_customer_livemode: boolean | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          current_level?: string | null;
          drive_folder_id?: string | null;
          drive_folder_url?: string | null;
          google_account_email?: string | null;
          notes?: string | null;
          profile_id: string;
          stripe_customer_account_id?: string | null;
          stripe_customer_id?: string | null;
          stripe_customer_livemode?: boolean | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          current_level?: string | null;
          drive_folder_id?: string | null;
          drive_folder_url?: string | null;
          google_account_email?: string | null;
          notes?: string | null;
          profile_id?: string;
          stripe_customer_account_id?: string | null;
          stripe_customer_id?: string | null;
          stripe_customer_livemode?: boolean | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_private_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      sessions: {
        Row: {
          calendar_event_id: string | null;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          completed_at: string | null;
          created_at: string | null;
          drive_doc_id: string | null;
          drive_doc_url: string | null;
          duration_minutes: number;
          id: string;
          meet_link: string | null;
          post_class_report: Json | null;
          reminder_sent: boolean;
          scheduled_at: string | null;
          status: string;
          student_id: string;
          subscription_id: string;
          teacher_id: string | null;
          teacher_notes: string | null;
          updated_at: string | null;
        };
        Insert: {
          calendar_event_id?: string | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          drive_doc_id?: string | null;
          drive_doc_url?: string | null;
          duration_minutes?: number;
          id?: string;
          meet_link?: string | null;
          post_class_report?: Json | null;
          reminder_sent?: boolean;
          scheduled_at?: string | null;
          status?: string;
          student_id: string;
          subscription_id: string;
          teacher_id?: string | null;
          teacher_notes?: string | null;
          updated_at?: string | null;
        };
        Update: {
          calendar_event_id?: string | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          drive_doc_id?: string | null;
          drive_doc_url?: string | null;
          duration_minutes?: number;
          id?: string;
          meet_link?: string | null;
          post_class_report?: Json | null;
          reminder_sent?: boolean;
          scheduled_at?: string | null;
          status?: string;
          student_id?: string;
          subscription_id?: string;
          teacher_id?: string | null;
          teacher_notes?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sessions_cancelled_by_fkey";
            columns: ["cancelled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sessions_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sessions_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sessions_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      staging_integration_smoke_leases: {
        Row: {
          expires_at: string;
          generation: number;
          lease_name: string;
          owner_token: string;
          run_id: string;
          updated_at: string;
        };
        Insert: {
          expires_at: string;
          generation?: number;
          lease_name: string;
          owner_token: string;
          run_id: string;
          updated_at?: string;
        };
        Update: {
          expires_at?: string;
          generation?: number;
          lease_name?: string;
          owner_token?: string;
          run_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      staging_integration_smoke_runs: {
        Row: {
          base_host: string;
          calendar_event_ids: string[];
          cancellation_job_id: string | null;
          created_at: string;
          drive_root_ids: string[];
          email_attempt_generation: number;
          email_budget_reserved: boolean;
          email_error_code: string | null;
          email_first_attempt_at: string | null;
          email_http_status: number | null;
          email_idempotency_key: string | null;
          email_last_attempt_at: string | null;
          email_locked_at: string | null;
          email_payload_sha256: string | null;
          email_provider_id: string | null;
          email_sent_at: string | null;
          email_status: string;
          fulfillment_job_id: string | null;
          lease_generation: number;
          lease_name: string;
          marker: string;
          original_full_name: string | null;
          original_private_profile: Json;
          phase: string;
          run_id: string;
          scheduled_at: string;
          session_id: string | null;
          status: string;
          student_id: string;
          subscription_id: string;
          teacher_id: string;
          updated_at: string;
        };
        Insert: {
          base_host: string;
          calendar_event_ids?: string[];
          cancellation_job_id?: string | null;
          created_at?: string;
          drive_root_ids?: string[];
          email_attempt_generation?: number;
          email_budget_reserved?: boolean;
          email_error_code?: string | null;
          email_first_attempt_at?: string | null;
          email_http_status?: number | null;
          email_idempotency_key?: string | null;
          email_last_attempt_at?: string | null;
          email_locked_at?: string | null;
          email_payload_sha256?: string | null;
          email_provider_id?: string | null;
          email_sent_at?: string | null;
          email_status?: string;
          fulfillment_job_id?: string | null;
          lease_generation: number;
          lease_name: string;
          marker: string;
          original_full_name?: string | null;
          original_private_profile: Json;
          phase: string;
          run_id: string;
          scheduled_at: string;
          session_id?: string | null;
          status: string;
          student_id: string;
          subscription_id: string;
          teacher_id: string;
          updated_at?: string;
        };
        Update: {
          base_host?: string;
          calendar_event_ids?: string[];
          cancellation_job_id?: string | null;
          created_at?: string;
          drive_root_ids?: string[];
          email_attempt_generation?: number;
          email_budget_reserved?: boolean;
          email_error_code?: string | null;
          email_first_attempt_at?: string | null;
          email_http_status?: number | null;
          email_idempotency_key?: string | null;
          email_last_attempt_at?: string | null;
          email_locked_at?: string | null;
          email_payload_sha256?: string | null;
          email_provider_id?: string | null;
          email_sent_at?: string | null;
          email_status?: string;
          fulfillment_job_id?: string | null;
          lease_generation?: number;
          lease_name?: string;
          marker?: string;
          original_full_name?: string | null;
          original_private_profile?: Json;
          phase?: string;
          run_id?: string;
          scheduled_at?: string;
          session_id?: string | null;
          status?: string;
          student_id?: string;
          subscription_id?: string;
          teacher_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staging_integration_smoke_runs_cancellation_job_id_fkey";
            columns: ["cancellation_job_id"];
            isOneToOne: false;
            referencedRelation: "fulfillment_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staging_integration_smoke_runs_fulfillment_job_id_fkey";
            columns: ["fulfillment_job_id"];
            isOneToOne: false;
            referencedRelation: "fulfillment_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staging_integration_smoke_runs_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staging_integration_smoke_runs_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staging_integration_smoke_runs_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staging_integration_smoke_runs_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      student_teachers: {
        Row: {
          assigned_at: string | null;
          id: string;
          is_primary: boolean | null;
          student_id: string;
          teacher_id: string;
        };
        Insert: {
          assigned_at?: string | null;
          id?: string;
          is_primary?: boolean | null;
          student_id: string;
          teacher_id: string;
        };
        Update: {
          assigned_at?: string | null;
          id?: string;
          is_primary?: boolean | null;
          student_id?: string;
          teacher_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_teachers_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "student_teachers_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          billing_interval_count: number | null;
          billing_interval_unit: string | null;
          checkout_intent_id: string | null;
          class_duration_minutes: number | null;
          contract_schema_version: number;
          contracted_sessions_per_period: number;
          created_at: string | null;
          duration_months: number | null;
          ends_at: string;
          id: string;
          package_id: string;
          package_price_id: string | null;
          sessions_total: number;
          sessions_used: number | null;
          starts_at: string;
          status: Database["public"]["Enums"]["subscription_status"] | null;
          stripe_invoice_id: string | null;
          stripe_subscription_id: string | null;
          student_id: string;
          updated_at: string | null;
        };
        Insert: {
          billing_interval_count?: number | null;
          billing_interval_unit?: string | null;
          checkout_intent_id?: string | null;
          class_duration_minutes?: number | null;
          contract_schema_version?: number;
          contracted_sessions_per_period: number;
          created_at?: string | null;
          duration_months?: number | null;
          ends_at: string;
          id?: string;
          package_id: string;
          package_price_id?: string | null;
          sessions_total: number;
          sessions_used?: number | null;
          starts_at: string;
          status?: Database["public"]["Enums"]["subscription_status"] | null;
          stripe_invoice_id?: string | null;
          stripe_subscription_id?: string | null;
          student_id: string;
          updated_at?: string | null;
        };
        Update: {
          billing_interval_count?: number | null;
          billing_interval_unit?: string | null;
          checkout_intent_id?: string | null;
          class_duration_minutes?: number | null;
          contract_schema_version?: number;
          contracted_sessions_per_period?: number;
          created_at?: string | null;
          duration_months?: number | null;
          ends_at?: string;
          id?: string;
          package_id?: string;
          package_price_id?: string | null;
          sessions_total?: number;
          sessions_used?: number | null;
          starts_at?: string;
          status?: Database["public"]["Enums"]["subscription_status"] | null;
          stripe_invoice_id?: string | null;
          stripe_subscription_id?: string | null;
          student_id?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_checkout_intent_id_fkey";
            columns: ["checkout_intent_id"];
            isOneToOne: false;
            referencedRelation: "checkout_intents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_package_id_fkey";
            columns: ["package_id"];
            isOneToOne: false;
            referencedRelation: "packages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_package_price_id_fkey";
            columns: ["package_price_id"];
            isOneToOne: false;
            referencedRelation: "package_prices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      support_tickets: {
        Row: {
          admin_notes: string | null;
          context: Json;
          created_at: string | null;
          id: string;
          issue_title: string;
          issue_type: string;
          message: string;
          page_url: string | null;
          status: string;
          updated_at: string | null;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          admin_notes?: string | null;
          context?: Json;
          created_at?: string | null;
          id?: string;
          issue_title: string;
          issue_type: string;
          message: string;
          page_url?: string | null;
          status?: string;
          updated_at?: string | null;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          admin_notes?: string | null;
          context?: Json;
          created_at?: string | null;
          id?: string;
          issue_title?: string;
          issue_type?: string;
          message?: string;
          page_url?: string | null;
          status?: string;
          updated_at?: string | null;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_tickets_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      teacher_availability: {
        Row: {
          created_at: string | null;
          day_of_week: number;
          end_time: string;
          id: string;
          is_active: boolean | null;
          start_time: string;
          teacher_id: string;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          day_of_week: number;
          end_time: string;
          id?: string;
          is_active?: boolean | null;
          start_time: string;
          teacher_id: string;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          day_of_week?: number;
          end_time?: string;
          id?: string;
          is_active?: boolean | null;
          start_time?: string;
          teacher_id?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_availability_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      acquire_staging_integration_smoke_lease: {
        Args: {
          p_lease_name: string;
          p_owner_token: string;
          p_run_id: string;
          p_ttl_seconds: number;
        };
        Returns: {
          acquired: boolean;
          expires_at: string;
          generation: number;
        }[];
      };
      activate_package_price: {
        Args: {
          p_activated_by?: string | null;
          p_amount_cents: number;
          p_catalog_version: number;
          p_currency: string;
          p_duration_months: number;
          p_package_id: string;
          p_stripe_account_id: string;
          p_stripe_livemode: boolean;
          p_stripe_price_id: string;
          p_stripe_product_id: string;
        };
        Returns: {
          activated_at: string;
          amount_cents: number;
          billing_interval_count: number | null;
          billing_interval_unit: string | null;
          catalog_version: number;
          class_duration_minutes: number | null;
          contract_schema_version: number;
          created_at: string;
          created_by: string | null;
          currency: string;
          display_name: Json;
          duration_months: number | null;
          has_dual_teacher: boolean;
          has_group_session: boolean;
          id: string;
          package_id: string;
          package_key: string;
          retired_at: string | null;
          sessions_per_month: number | null;
          sessions_per_period: number;
          status: string;
          stripe_account_id: string | null;
          stripe_livemode: boolean;
          stripe_price_id: string;
          stripe_product_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "package_prices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      activate_versioned_package_price: {
        Args: {
          p_activated_by?: string | null;
          p_amount_cents: number;
          p_billing_interval_count: number;
          p_billing_interval_unit: string;
          p_catalog_version: number;
          p_class_duration_minutes: number;
          p_currency: string;
          p_package_id: string;
          p_sessions_per_period: number;
          p_stripe_account_id: string;
          p_stripe_livemode: boolean;
          p_stripe_price_id: string;
          p_stripe_product_id: string;
        };
        Returns: Database["public"]["Tables"]["package_prices"]["Row"];
        SetofOptions: {
          from: "*";
          to: "package_prices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      apply_subscription_renewal: {
        Args: {
          p_new_ends_at: string;
          p_stripe_invoice_id: string;
          p_stripe_subscription_id: string;
          p_subscription_id: string;
        };
        Returns: boolean;
      };
      cancel_scheduled_session: {
        Args: {
          p_cancellation_reason?: string | null;
          p_cancelled_by: string;
          p_cancelled_by_role: string;
          p_session_id: string;
        };
        Returns: {
          cancelled_at: string;
          hours_until_class: number | null;
          late_student_cancellation: boolean;
          next_sessions_used: number | null;
          previous_sessions_used: number | null;
          quota_restore_attempted: boolean;
          quota_restored: boolean;
          session_id: string;
          subscription_id: string | null;
        }[];
      };
      claim_checkout_intent: {
        Args: {
          p_contact_id: string;
          p_lang: string;
          p_legal_policy_version: string;
          p_opportunity_id: string;
          p_package_price_id: string;
          p_site_url: string;
          p_student_id: string;
        };
        Returns: {
          completed_at: string | null;
          contact_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          lang: string;
          legal_policy_version: string;
          opportunity_id: string;
          package_price_id: string;
          policy_accepted_at: string;
          site_url: string;
          status: string;
          stripe_checkout_session_id: string | null;
          stripe_customer_id: string | null;
          stripe_session_expires_at: string;
          student_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "checkout_intents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      claim_checkout_intent_for_slot: {
        Args: {
          p_contact_id: string;
          p_lang: string;
          p_legal_policy_version: string;
          p_opportunity_id: string;
          p_package_price_id: string;
          p_site_url: string;
          p_slot_id: string;
          p_student_id: string;
        };
        Returns: Database["public"]["Tables"]["checkout_intents"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_intents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      claim_fulfillment_effect: {
        Args: {
          p_effect_key: string;
          p_effect_type: string;
          p_job_id: string;
          p_lease_owner: string;
          p_lease_seconds?: number;
          p_payload_sha256: string;
        };
        Returns: {
          attempt_generation: number;
          claimed: boolean;
          effect_id: string;
          effect_status: string;
          provider_id: string | null;
          result: Json | null;
        }[];
      };
      claim_staging_integration_smoke_email: {
        Args: {
          p_base_host: string;
          p_daily_limit: number;
          p_generation: number;
          p_lease_name: string;
          p_monthly_limit: number;
          p_owner_token: string;
          p_payload_sha256: string;
          p_run_id: string;
          p_smoke_marker: string;
        };
        Returns: {
          attempt_generation: number;
          claimed: boolean;
          email_status: string;
          idempotency_key: string;
          provider_id: string | null;
        }[];
      };
      claim_staging_integration_smoke_job: {
        Args: {
          p_dedupe_key: string;
          p_generation: number;
          p_job_id: string;
          p_lease_name: string;
          p_owner_token: string;
          p_run_id: string;
          p_smoke_marker: string;
          p_student_id: string;
          p_worker_id: string;
        };
        Returns: {
          attempts: number;
          claimed: boolean;
          job_status: string;
        }[];
      };
      complete_checkout_intent: {
        Args: {
          p_intent_id: string;
          p_opportunity_id: string;
          p_package_price_id: string;
          p_stripe_checkout_session_id: string;
          p_stripe_customer_id: string;
          p_student_id: string;
        };
        Returns: {
          completed_at: string | null;
          contact_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          lang: string;
          legal_policy_version: string;
          opportunity_id: string;
          package_price_id: string;
          policy_accepted_at: string;
          site_url: string;
          status: string;
          stripe_checkout_session_id: string | null;
          stripe_customer_id: string | null;
          stripe_session_expires_at: string;
          student_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "checkout_intents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      consume_bookable_slot_hold: {
        Args: {
          p_checkout_intent_id: string;
          p_subscription_id: string;
        };
        Returns: Database["public"]["Tables"]["bookable_slot_holds"]["Row"];
        SetofOptions: {
          from: "*";
          to: "bookable_slot_holds";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_bookable_slot: {
        Args: {
          p_created_by: string;
          p_occurrences: string[];
          p_package_id: string;
          p_teacher_id: string;
          p_timezone_name: string;
        };
        Returns: Database["public"]["Tables"]["bookable_slots"]["Row"];
        SetofOptions: {
          from: "*";
          to: "bookable_slots";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      finalize_fulfillment_effect: {
        Args: {
          p_attempt_generation: number;
          p_effect_id: string;
          p_error?: Json | null;
          p_lease_owner: string;
          p_outcome: string;
          p_provider_id?: string | null;
          p_result?: Json | null;
        };
        Returns: boolean;
      };
      finalize_staging_integration_smoke_email: {
        Args: {
          p_attempt_generation: number;
          p_error_code: string | null;
          p_generation: number;
          p_http_status: number | null;
          p_lease_name: string;
          p_outcome: string;
          p_owner_token: string;
          p_provider_id: string | null;
          p_run_id: string;
        };
        Returns: boolean;
      };
      finalize_staging_integration_smoke_job: {
        Args: {
          p_attempts: number;
          p_generation: number;
          p_job_id: string;
          p_lease_name: string;
          p_owner_token: string;
          p_run_id: string;
          p_succeeded: boolean;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      get_available_slots: {
        Args: {
          p_date: string;
          p_duration_minutes?: number;
          p_teacher_id: string;
        };
        Returns: {
          slot_end: string;
          slot_start: string;
        }[];
      };
      hold_bookable_slot: {
        Args: {
          p_checkout_intent_id: string;
          p_slot_id: string;
        };
        Returns: Database["public"]["Tables"]["bookable_slot_holds"]["Row"];
        SetofOptions: {
          from: "*";
          to: "bookable_slot_holds";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      materialize_bookable_slot_sessions: {
        Args: {
          p_slot_id: string;
          p_subscription_id: string;
        };
        Returns: Database["public"]["Tables"]["bookable_slots"]["Row"];
        SetofOptions: {
          from: "*";
          to: "bookable_slots";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      publish_bookable_slot: {
        Args: {
          p_published_by: string;
          p_slot_id: string;
        };
        Returns: Database["public"]["Tables"]["bookable_slots"]["Row"];
        SetofOptions: {
          from: "*";
          to: "bookable_slots";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      reconcile_stripe_refund: {
        Args: {
          p_amount_refunded: number;
          p_payment_id: string;
          p_refunded_at: string;
          p_stripe_refund_id: string;
        };
        Returns: {
          amount: number;
          amount_refunded: number;
          created_at: string | null;
          currency: string | null;
          description: string | null;
          id: string;
          refunded_at: string | null;
          status: Database["public"]["Enums"]["payment_status"] | null;
          stripe_invoice_id: string | null;
          stripe_payment_intent_id: string | null;
          stripe_refund_id: string | null;
          student_id: string;
          subscription_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "payments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      release_abandoned_checkout_intent: {
        Args: { p_intent_id: string; p_stripe_customer_id: string };
        Returns: {
          completed_at: string | null;
          contact_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          lang: string;
          legal_policy_version: string;
          opportunity_id: string;
          package_price_id: string;
          policy_accepted_at: string;
          site_url: string;
          status: string;
          stripe_checkout_session_id: string | null;
          stripe_customer_id: string | null;
          stripe_session_expires_at: string;
          student_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "checkout_intents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      release_bookable_slot_hold: {
        Args: {
          p_checkout_intent_id: string;
          p_reason: string;
        };
        Returns: Database["public"]["Tables"]["bookable_slot_holds"]["Row"];
        SetofOptions: {
          from: "*";
          to: "bookable_slot_holds";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      release_expired_checkout_intent: {
        Args: { p_intent_id: string; p_stripe_checkout_session_id: string };
        Returns: {
          completed_at: string | null;
          contact_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          lang: string;
          legal_policy_version: string;
          opportunity_id: string;
          package_price_id: string;
          policy_accepted_at: string;
          site_url: string;
          status: string;
          stripe_checkout_session_id: string | null;
          stripe_customer_id: string | null;
          stripe_session_expires_at: string;
          student_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "checkout_intents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      release_staging_integration_smoke_lease: {
        Args: {
          p_generation: number;
          p_lease_name: string;
          p_owner_token: string;
          p_run_id: string;
        };
        Returns: boolean;
      };
      renew_staging_integration_smoke_lease: {
        Args: {
          p_generation: number;
          p_lease_name: string;
          p_owner_token: string;
          p_run_id: string;
          p_ttl_seconds: number;
        };
        Returns: {
          expires_at: string;
          renewed: boolean;
        }[];
      };
      reserve_email_recipient_budget: {
        Args: {
          p_budget_scope: string;
          p_daily_limit: number;
          p_monthly_limit: number;
          p_recipient_count: number;
          p_source: string;
        };
        Returns: {
          daily_used: number;
          monthly_used: number;
        }[];
      };
      session_tstzrange: {
        Args: { dur_min: number; start_at: string };
        Returns: unknown;
      };
      snapshot_checkout_intent_customer: {
        Args: { p_intent_id: string; p_stripe_customer_id: string };
        Returns: {
          completed_at: string | null;
          contact_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          lang: string;
          legal_policy_version: string;
          opportunity_id: string;
          package_price_id: string;
          policy_accepted_at: string;
          site_url: string;
          status: string;
          stripe_checkout_session_id: string | null;
          stripe_customer_id: string | null;
          stripe_session_expires_at: string;
          student_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "checkout_intents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      lead_status: "new" | "contacted" | "discarded";
      payment_status: "succeeded" | "pending" | "failed" | "refunded";
      subscription_status:
        | "active"
        | "paused"
        | "cancelled"
        | "expired"
        | "pending";
      user_role: "student" | "teacher" | "admin";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      lead_status: ["new", "contacted", "discarded"],
      payment_status: ["succeeded", "pending", "failed", "refunded"],
      subscription_status: [
        "active",
        "paused",
        "cancelled",
        "expired",
        "pending",
      ],
      user_role: ["student", "teacher", "admin"],
    },
  },
} as const;
