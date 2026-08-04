// Generated from the Supabase schema and reconciled through the pending
// 20260803182652 managed-content workflow. PostgreSQL's catalog does not
// expose NULL semantics for PL/pgSQL argument/result fields precisely; the
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
      admin_role_assignments: {
        Row: {
          access_role: Database["public"]["Enums"]["admin_access_role"];
          granted_at: string;
          granted_by: string | null;
          profile_id: string;
        };
        Insert: {
          access_role: Database["public"]["Enums"]["admin_access_role"];
          granted_at?: string;
          granted_by?: string | null;
          profile_id: string;
        };
        Update: {
          access_role?: Database["public"]["Enums"]["admin_access_role"];
          granted_at?: string;
          granted_by?: string | null;
          profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "admin_role_assignments_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_role_assignments_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      acquisition_attribution_events: {
        Row: {
          captured_at: string;
          checkout_intent_id: string | null;
          contact_id: string;
          created_at: string;
          entry_language: string;
          event_kind: string;
          id: string;
          landing_path: string;
          lead_id: string | null;
          referrer_host: string | null;
          referrer_kind: string;
          referrer_path: string | null;
          request_id: string;
          utm_campaign: string | null;
          utm_content: string | null;
          utm_medium: string | null;
          utm_source: string | null;
          utm_term: string | null;
        };
        Insert: {
          captured_at?: string;
          checkout_intent_id?: string | null;
          contact_id: string;
          created_at?: string;
          entry_language: string;
          event_kind: string;
          id?: string;
          landing_path: string;
          lead_id?: string | null;
          referrer_host?: string | null;
          referrer_kind: string;
          referrer_path?: string | null;
          request_id: string;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
        };
        Update: {
          captured_at?: string;
          checkout_intent_id?: string | null;
          contact_id?: string;
          created_at?: string;
          entry_language?: string;
          event_kind?: string;
          id?: string;
          landing_path?: string;
          lead_id?: string | null;
          referrer_host?: string | null;
          referrer_kind?: string;
          referrer_path?: string | null;
          request_id?: string;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "acquisition_attribution_event_checkout_contact_fkey";
            columns: ["checkout_intent_id", "contact_id"];
            isOneToOne: false;
            referencedRelation: "checkout_intents";
            referencedColumns: ["id", "contact_id"];
          },
          {
            foreignKeyName: "acquisition_attribution_event_lead_contact_fkey";
            columns: ["lead_id", "contact_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id", "crm_contact_id"];
          },
          {
            foreignKeyName: "acquisition_attribution_events_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "crm_contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      acquisition_campaigns: {
        Row: {
          created_at: string;
          created_by: string;
          external_reference: string | null;
          id: string;
          name: string;
          provider: string;
          request_id: string;
          utm_campaign: string | null;
          utm_content: string | null;
          utm_medium: string | null;
          utm_source: string | null;
          utm_term: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          external_reference?: string | null;
          id?: string;
          name: string;
          provider: string;
          request_id: string;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          external_reference?: string | null;
          id?: string;
          name?: string;
          provider?: string;
          request_id?: string;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "acquisition_campaigns_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      acquisition_cost_allocation_ledger: {
        Row: {
          allocated_by: string;
          amount_delta_cents: number;
          basis: string;
          campaign_id: string;
          checkout_attribution_event_id: string | null;
          checkout_intent_id: string;
          contact_id: string;
          created_at: string;
          currency: string;
          entry_kind: string;
          first_cycle_id: string;
          first_subscription_id: string;
          id: string;
          original_allocation_id: string | null;
          reason: string | null;
          request_id: string;
          student_id: string;
        };
        Insert: {
          allocated_by: string;
          amount_delta_cents: number;
          basis: string;
          campaign_id: string;
          checkout_attribution_event_id?: string | null;
          checkout_intent_id: string;
          contact_id: string;
          created_at?: string;
          currency?: string;
          entry_kind: string;
          first_cycle_id: string;
          first_subscription_id: string;
          id?: string;
          original_allocation_id?: string | null;
          reason?: string | null;
          request_id: string;
          student_id: string;
        };
        Update: {
          allocated_by?: string;
          amount_delta_cents?: number;
          basis?: string;
          campaign_id?: string;
          checkout_attribution_event_id?: string | null;
          checkout_intent_id?: string;
          contact_id?: string;
          created_at?: string;
          currency?: string;
          entry_kind?: string;
          first_cycle_id?: string;
          first_subscription_id?: string;
          id?: string;
          original_allocation_id?: string | null;
          reason?: string | null;
          request_id?: string;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "acquisition_allocation_attribution_identity_fkey";
            columns: [
              "checkout_attribution_event_id",
              "contact_id",
              "checkout_intent_id",
            ];
            isOneToOne: false;
            referencedRelation: "acquisition_attribution_events";
            referencedColumns: ["id", "contact_id", "checkout_intent_id"];
          },
          {
            foreignKeyName: "acquisition_allocation_contact_student_fkey";
            columns: ["contact_id", "student_id"];
            isOneToOne: false;
            referencedRelation: "crm_contacts";
            referencedColumns: ["id", "profile_id"];
          },
          {
            foreignKeyName: "acquisition_allocation_cycle_subscription_fkey";
            columns: ["first_cycle_id", "first_subscription_id"];
            isOneToOne: false;
            referencedRelation: "checkout_v2_cycles";
            referencedColumns: ["id", "subscription_id"];
          },
          {
            foreignKeyName: "acquisition_allocation_subscription_identity_fkey";
            columns: ["first_subscription_id", "student_id", "checkout_intent_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id", "student_id", "checkout_intent_id"];
          },
          {
            foreignKeyName: "acquisition_cost_allocation_ledger_allocated_by_fkey";
            columns: ["allocated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "acquisition_cost_allocation_ledger_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "acquisition_campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "acquisition_cost_allocation_ledger_original_allocation_id_fkey";
            columns: ["original_allocation_id"];
            isOneToOne: false;
            referencedRelation: "acquisition_cost_allocation_ledger";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "acquisition_cost_allocation_ledger_student_id_fkey";
            columns: ["student_id"];
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
          hold_fingerprint: string | null;
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
          hold_fingerprint?: string | null;
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
          hold_fingerprint?: string | null;
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
      bookable_slot_admin_operations: {
        Row: {
          action: string;
          admin_id: string;
          after_snapshot: Json;
          before_snapshot: Json | null;
          created_at: string;
          id: string;
          normalized_payload: Json;
          reason: string;
          request_id: string;
          slot_id: string;
        };
        Insert: {
          action: string;
          admin_id: string;
          after_snapshot: Json;
          before_snapshot?: Json | null;
          created_at?: string;
          id?: string;
          normalized_payload: Json;
          reason: string;
          request_id: string;
          slot_id: string;
        };
        Update: {
          action?: string;
          admin_id?: string;
          after_snapshot?: Json;
          before_snapshot?: Json | null;
          created_at?: string;
          id?: string;
          normalized_payload?: Json;
          reason?: string;
          request_id?: string;
          slot_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookable_slot_admin_operations_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookable_slot_admin_operations_slot_id_fkey";
            columns: ["slot_id"];
            isOneToOne: false;
            referencedRelation: "bookable_slots";
            referencedColumns: ["id"];
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
      checkout_v2_billing_state: {
        Row: {
          anchor_fixed_at: string | null;
          anchor_revision: number;
          anchor_state: string;
          created_at: string;
          first_class_at: string;
          first_session_id: string;
          renewal_anchor_at: string;
          stripe_renewal_anchor_at: string;
          subscription_id: string;
          updated_at: string;
        };
        Insert: {
          anchor_fixed_at?: string | null;
          anchor_revision?: number;
          anchor_state?: string;
          created_at?: string;
          first_class_at: string;
          first_session_id: string;
          renewal_anchor_at: string;
          stripe_renewal_anchor_at: string;
          subscription_id: string;
          updated_at?: string;
        };
        Update: {
          anchor_fixed_at?: string | null;
          anchor_revision?: number;
          anchor_state?: string;
          created_at?: string;
          first_class_at?: string;
          first_session_id?: string;
          renewal_anchor_at?: string;
          stripe_renewal_anchor_at?: string;
          subscription_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "checkout_v2_billing_state_first_session_id_fkey";
            columns: ["first_session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_billing_state_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: true;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      checkout_v2_guarantee_operations: {
        Row: {
          actor_id: string;
          cancellation_started_at: string | null;
          claimed_at: string | null;
          created_at: string;
          currency: string;
          cycle_id: string;
          cycle_number: number;
          first_session_id: string;
          fourth_session_id: string | null;
          gross_amount_cents: number;
          id: string;
          last_error: string | null;
          lease_expires_at: string | null;
          lease_token: string | null;
          payment_id: string;
          package_price_id: string;
          refund_amount_cents: number;
          refund_created_at: string | null;
          refund_started_at: string | null;
          refund_status: string | null;
          refunded_at: string | null;
          request_id: string;
          second_session_id: string;
          session_base_amount_cents: number;
          session_remainder_units: number;
          sessions_consumed: number;
          sessions_total: number;
          status: string;
          stripe_cancelled_at: string | null;
          stripe_customer_id: string;
          stripe_invoice_id: string;
          stripe_payment_intent_id: string;
          stripe_refund_id: string | null;
          stripe_subscription_id: string;
          support_ticket_id: string | null;
          terminated_at: string | null;
          third_session_id: string | null;
          subscription_id: string;
          updated_at: string;
        };
        Insert: {
          actor_id: string;
          cancellation_started_at?: string | null;
          claimed_at?: string | null;
          created_at?: string;
          currency: string;
          cycle_id: string;
          cycle_number: number;
          first_session_id: string;
          fourth_session_id?: string | null;
          gross_amount_cents: number;
          id?: string;
          last_error?: string | null;
          lease_expires_at?: string | null;
          lease_token?: string | null;
          payment_id: string;
          package_price_id: string;
          refund_amount_cents: number;
          refund_created_at?: string | null;
          refund_started_at?: string | null;
          refund_status?: string | null;
          refunded_at?: string | null;
          request_id: string;
          second_session_id: string;
          session_base_amount_cents: number;
          session_remainder_units: number;
          sessions_consumed: number;
          sessions_total: number;
          status?: string;
          stripe_cancelled_at?: string | null;
          stripe_customer_id: string;
          stripe_invoice_id: string;
          stripe_payment_intent_id: string;
          stripe_refund_id?: string | null;
          stripe_subscription_id: string;
          support_ticket_id?: string | null;
          terminated_at?: string | null;
          third_session_id?: string | null;
          subscription_id: string;
          updated_at?: string;
        };
        Update: {
          actor_id?: string;
          cancellation_started_at?: string | null;
          claimed_at?: string | null;
          created_at?: string;
          currency?: string;
          cycle_id?: string;
          cycle_number?: number;
          first_session_id?: string;
          fourth_session_id?: string | null;
          gross_amount_cents?: number;
          id?: string;
          last_error?: string | null;
          lease_expires_at?: string | null;
          lease_token?: string | null;
          payment_id?: string;
          package_price_id?: string;
          refund_amount_cents?: number;
          refund_created_at?: string | null;
          refund_started_at?: string | null;
          refund_status?: string | null;
          refunded_at?: string | null;
          request_id?: string;
          second_session_id?: string;
          session_base_amount_cents?: number;
          session_remainder_units?: number;
          sessions_consumed?: number;
          sessions_total?: number;
          status?: string;
          stripe_cancelled_at?: string | null;
          stripe_customer_id?: string;
          stripe_invoice_id?: string;
          stripe_payment_intent_id?: string;
          stripe_refund_id?: string | null;
          stripe_subscription_id?: string;
          support_ticket_id?: string | null;
          terminated_at?: string | null;
          third_session_id?: string | null;
          subscription_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "checkout_v2_guarantee_operations_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_guarantee_operations_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: true;
            referencedRelation: "checkout_v2_cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_guarantee_operations_first_session_id_fkey";
            columns: ["first_session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_guarantee_operations_fourth_session_id_fkey";
            columns: ["fourth_session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_guarantee_operations_package_price_id_fkey";
            columns: ["package_price_id"];
            isOneToOne: false;
            referencedRelation: "package_prices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_guarantee_operations_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: true;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_guarantee_operations_second_session_id_fkey";
            columns: ["second_session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_guarantee_operations_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: true;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_guarantee_operations_support_ticket_id_fkey";
            columns: ["support_ticket_id"];
            isOneToOne: true;
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_guarantee_operations_third_session_id_fkey";
            columns: ["third_session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      checkout_v2_guarantee_operation_sessions: {
        Row: {
          amount_cents: number;
          created_at: string;
          cycle_id: string;
          operation_id: string;
          session_id: string;
          session_index: number;
          was_consumed: boolean;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          cycle_id: string;
          operation_id: string;
          session_id: string;
          session_index: number;
          was_consumed: boolean;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          cycle_id?: string;
          operation_id?: string;
          session_id?: string;
          session_index?: number;
          was_consumed?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "checkout_v2_guarantee_operation_sessions_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "checkout_v2_cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_guarantee_operation_sessions_operation_id_fkey";
            columns: ["operation_id"];
            isOneToOne: false;
            referencedRelation: "checkout_v2_guarantee_operations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_guarantee_operation_sessions_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      checkout_v2_reschedule_operations: {
        Row: {
          actor_id: string;
          applied_at: string | null;
          created_at: string;
          cycle_id: string;
          expected_anchor_revision: number;
          id: string;
          last_error: string | null;
          new_scheduled_at: string;
          observed_stripe_anchor_at: string | null;
          old_scheduled_at: string;
          operation_kind: string;
          request_id: string;
          session_id: string;
          status: string;
          stripe_mutation_started_at: string | null;
          subscription_id: string;
          target_stripe_anchor_at: string | null;
          updated_at: string;
        };
        Insert: {
          actor_id: string;
          applied_at?: string | null;
          created_at?: string;
          cycle_id: string;
          expected_anchor_revision: number;
          id?: string;
          last_error?: string | null;
          new_scheduled_at: string;
          observed_stripe_anchor_at?: string | null;
          old_scheduled_at: string;
          operation_kind: string;
          request_id: string;
          session_id: string;
          status?: string;
          stripe_mutation_started_at?: string | null;
          subscription_id: string;
          target_stripe_anchor_at?: string | null;
          updated_at?: string;
        };
        Update: {
          actor_id?: string;
          applied_at?: string | null;
          created_at?: string;
          cycle_id?: string;
          expected_anchor_revision?: number;
          id?: string;
          last_error?: string | null;
          new_scheduled_at?: string;
          observed_stripe_anchor_at?: string | null;
          old_scheduled_at?: string;
          operation_kind?: string;
          request_id?: string;
          session_id?: string;
          status?: string;
          stripe_mutation_started_at?: string | null;
          subscription_id?: string;
          target_stripe_anchor_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "checkout_v2_reschedule_operations_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_reschedule_operations_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "checkout_v2_cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_reschedule_operations_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_reschedule_operations_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      checkout_v2_session_incident_resolutions: {
        Row: {
          admin_id: string;
          created_at: string;
          cycle_id: string;
          id: string;
          incident_at: string;
          original_scheduled_at: string;
          original_status: string;
          reason: string;
          resolution: string;
          session_id: string;
          session_index: number;
          subscription_id: string;
        };
        Insert: {
          admin_id: string;
          created_at?: string;
          cycle_id: string;
          id?: string;
          incident_at: string;
          original_scheduled_at: string;
          original_status: string;
          reason: string;
          resolution?: string;
          session_id: string;
          session_index: number;
          subscription_id: string;
        };
        Update: {
          admin_id?: string;
          created_at?: string;
          cycle_id?: string;
          id?: string;
          incident_at?: string;
          original_scheduled_at?: string;
          original_status?: string;
          reason?: string;
          resolution?: string;
          session_id?: string;
          session_index?: number;
          subscription_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "checkout_v2_session_incident_resolutions_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_session_incident_resolutions_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "checkout_v2_cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_session_incident_resolutions_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_session_incident_resolutions_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      checkout_v2_session_credit_adjustments: {
        Row: {
          admin_id: string;
          created_at: string;
          cycle_id: string;
          effect: string;
          id: string;
          reason: string;
          request_id: string;
          session_id: string;
          session_index: number;
          subscription_id: string;
        };
        Insert: {
          admin_id: string;
          created_at?: string;
          cycle_id: string;
          effect?: string;
          id?: string;
          reason: string;
          request_id: string;
          session_id: string;
          session_index: number;
          subscription_id: string;
        };
        Update: {
          admin_id?: string;
          created_at?: string;
          cycle_id?: string;
          effect?: string;
          id?: string;
          reason?: string;
          request_id?: string;
          session_id?: string;
          session_index?: number;
          subscription_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "checkout_v2_session_credit_adjustments_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_session_credit_adjustments_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "checkout_v2_cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_session_credit_adjustments_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_session_credit_adjustments_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      checkout_v2_cycles: {
        Row: {
          amount_cents: number;
          created_at: string;
          currency: string;
          cycle_kind: string;
          cycle_number: number;
          ends_at: string;
          id: string;
          materialization_state: string;
          payment_id: string;
          sessions_materialized_at: string | null;
          sessions_total: number;
          starts_at: string;
          stripe_invoice_id: string;
          stripe_price_id: string;
          subscription_id: string;
          updated_at: string;
        };
        Insert: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          cycle_kind: string;
          cycle_number: number;
          ends_at: string;
          id?: string;
          materialization_state?: string;
          payment_id: string;
          sessions_materialized_at?: string | null;
          sessions_total?: number;
          starts_at: string;
          stripe_invoice_id: string;
          stripe_price_id: string;
          subscription_id: string;
          updated_at?: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          cycle_kind?: string;
          cycle_number?: number;
          ends_at?: string;
          id?: string;
          materialization_state?: string;
          payment_id?: string;
          sessions_materialized_at?: string | null;
          sessions_total?: number;
          starts_at?: string;
          stripe_invoice_id?: string;
          stripe_price_id?: string;
          subscription_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "checkout_v2_cycles_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: true;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkout_v2_cycles_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      checkout_v2_price_snapshots: {
        Row: {
          class_duration_minutes: number;
          created_at: string;
          currency: string;
          initial_amount_cents: number;
          initial_stripe_price_id: string;
          package_price_id: string;
          recurring_amount_cents: number;
          recurring_interval_count: number;
          recurring_interval_unit: string;
          recurring_stripe_price_id: string;
          session_base_amount_cents: number;
          session_remainder_units: number;
          sessions_per_period: number;
          stripe_account_id: string;
          stripe_livemode: boolean;
        };
        Insert: {
          class_duration_minutes: number;
          created_at?: string;
          currency: string;
          initial_amount_cents: number;
          initial_stripe_price_id: string;
          package_price_id: string;
          recurring_amount_cents: number;
          recurring_interval_count: number;
          recurring_interval_unit: string;
          recurring_stripe_price_id: string;
          session_base_amount_cents: number;
          session_remainder_units: number;
          sessions_per_period: number;
          stripe_account_id: string;
          stripe_livemode: boolean;
        };
        Update: {
          class_duration_minutes?: number;
          created_at?: string;
          currency?: string;
          initial_amount_cents?: number;
          initial_stripe_price_id?: string;
          package_price_id?: string;
          recurring_amount_cents?: number;
          recurring_interval_count?: number;
          recurring_interval_unit?: string;
          recurring_stripe_price_id?: string;
          session_base_amount_cents?: number;
          session_remainder_units?: number;
          sessions_per_period?: number;
          stripe_account_id?: string;
          stripe_livemode?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "checkout_v2_price_snapshots_package_price_id_fkey";
            columns: ["package_price_id"];
            isOneToOne: true;
            referencedRelation: "package_prices";
            referencedColumns: ["id"];
          },
        ];
      };
      checkout_v2_weekly_allocations: {
        Row: {
          created_at: string;
          duration_minutes: number;
          id: string;
          local_start_time: string;
          release_reason: string | null;
          released_at: string | null;
          slot_id: string;
          status: string;
          subscription_id: string | null;
          teacher_id: string;
          timezone_name: string;
          updated_at: string;
          weekday: number;
          weekly_start_minute: number | null;
        };
        Insert: {
          created_at?: string;
          duration_minutes?: number;
          id?: string;
          local_start_time: string;
          release_reason?: string | null;
          released_at?: string | null;
          slot_id: string;
          status?: string;
          subscription_id?: string | null;
          teacher_id: string;
          timezone_name?: string;
          updated_at?: string;
          weekday: number;
          weekly_start_minute?: number | null;
        };
        Update: {
          created_at?: string;
          duration_minutes?: number;
          id?: string;
          local_start_time?: string;
          release_reason?: string | null;
          released_at?: string | null;
          slot_id?: string;
          status?: string;
          subscription_id?: string | null;
          teacher_id?: string;
          timezone_name?: string;
          updated_at?: string;
          weekday?: number;
          weekly_start_minute?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "checkout_v2_allocation_slot_teacher_fkey";
            columns: ["slot_id", "teacher_id"];
            isOneToOne: false;
            referencedRelation: "bookable_slots";
            referencedColumns: ["id", "teacher_id"];
          },
          {
            foreignKeyName: "checkout_v2_weekly_allocations_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      cms_content_drafts: {
        Row: {
          base_version: number;
          created_at: string;
          created_by: string | null;
          discarded_at: string | null;
          document_id: string;
          id: string;
          payload: Json;
          published_at: string | null;
          published_version: number | null;
          revision: number;
          status: Database["public"]["Enums"]["cms_content_draft_status"];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          base_version: number;
          created_at?: string;
          created_by?: string | null;
          discarded_at?: string | null;
          document_id: string;
          id?: string;
          payload: Json;
          published_at?: string | null;
          published_version?: number | null;
          revision?: number;
          status?: Database["public"]["Enums"]["cms_content_draft_status"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          base_version?: number;
          created_at?: string;
          created_by?: string | null;
          discarded_at?: string | null;
          document_id?: string;
          id?: string;
          payload?: Json;
          published_at?: string | null;
          published_version?: number | null;
          revision?: number;
          status?: Database["public"]["Enums"]["cms_content_draft_status"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "cms_content_drafts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cms_content_drafts_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "cms_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cms_content_drafts_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      cms_content_versions: {
        Row: {
          document_id: string;
          id: string;
          operation_id: string;
          payload: Json;
          published_at: string;
          published_by: string | null;
          source_draft_id: string | null;
          version: number;
        };
        Insert: {
          document_id: string;
          id?: string;
          operation_id: string;
          payload: Json;
          published_at?: string;
          published_by?: string | null;
          source_draft_id?: string | null;
          version: number;
        };
        Update: {
          document_id?: string;
          id?: string;
          operation_id?: string;
          payload?: Json;
          published_at?: string;
          published_by?: string | null;
          source_draft_id?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "cms_content_versions_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "cms_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cms_content_versions_published_by_fkey";
            columns: ["published_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cms_content_versions_source_draft_id_fkey";
            columns: ["source_draft_id"];
            isOneToOne: false;
            referencedRelation: "cms_content_drafts";
            referencedColumns: ["id"];
          },
        ];
      };
      cms_documents: {
        Row: {
          content_key: string;
          created_at: string;
          current_version: number;
          id: string;
          locale: Database["public"]["Enums"]["cms_content_locale"];
          published_at: string | null;
          published_by: string | null;
          published_payload: Json | null;
          updated_at: string;
        };
        Insert: {
          content_key: string;
          created_at?: string;
          current_version?: number;
          id?: string;
          locale: Database["public"]["Enums"]["cms_content_locale"];
          published_at?: string | null;
          published_by?: string | null;
          published_payload?: Json | null;
          updated_at?: string;
        };
        Update: {
          content_key?: string;
          created_at?: string;
          current_version?: number;
          id?: string;
          locale?: Database["public"]["Enums"]["cms_content_locale"];
          published_at?: string | null;
          published_by?: string | null;
          published_payload?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cms_documents_published_by_fkey";
            columns: ["published_by"];
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
          idempotency_key: string | null;
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
          idempotency_key?: string | null;
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
          idempotency_key?: string | null;
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
          idempotency_key: string | null;
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
          idempotency_key?: string | null;
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
          idempotency_key?: string | null;
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
      package_catalog_drafts: {
        Row: {
          amount_cents: number;
          base_catalog_version: number;
          billing_interval_count: number;
          billing_interval_unit: string;
          class_duration_minutes: number;
          created_at: string;
          created_by: string;
          currency: string;
          discarded_at: string | null;
          display_name: Json;
          has_dual_teacher: boolean;
          has_group_session: boolean;
          id: string;
          is_publicly_listed: boolean;
          package_id: string;
          package_key: string;
          published_at: string | null;
          published_package_price_id: string | null;
          revision: number;
          sessions_per_period: number;
          status: Database["public"]["Enums"]["package_catalog_draft_status"];
          updated_at: string;
          updated_by: string;
        };
        Insert: {
          amount_cents: number;
          base_catalog_version: number;
          billing_interval_count: number;
          billing_interval_unit: string;
          class_duration_minutes: number;
          created_at?: string;
          created_by: string;
          currency?: string;
          discarded_at?: string | null;
          display_name: Json;
          has_dual_teacher?: boolean;
          has_group_session?: boolean;
          id?: string;
          is_publicly_listed?: boolean;
          package_id: string;
          package_key: string;
          published_at?: string | null;
          published_package_price_id?: string | null;
          revision?: number;
          sessions_per_period: number;
          status?: Database["public"]["Enums"]["package_catalog_draft_status"];
          updated_at?: string;
          updated_by: string;
        };
        Update: {
          amount_cents?: number;
          base_catalog_version?: number;
          billing_interval_count?: number;
          billing_interval_unit?: string;
          class_duration_minutes?: number;
          created_at?: string;
          created_by?: string;
          currency?: string;
          discarded_at?: string | null;
          display_name?: Json;
          has_dual_teacher?: boolean;
          has_group_session?: boolean;
          id?: string;
          is_publicly_listed?: boolean;
          package_id?: string;
          package_key?: string;
          published_at?: string | null;
          published_package_price_id?: string | null;
          revision?: number;
          sessions_per_period?: number;
          status?: Database["public"]["Enums"]["package_catalog_draft_status"];
          updated_at?: string;
          updated_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "package_catalog_drafts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "package_catalog_drafts_package_id_fkey";
            columns: ["package_id"];
            isOneToOne: false;
            referencedRelation: "packages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "package_catalog_drafts_published_package_price_id_fkey";
            columns: ["published_package_price_id"];
            isOneToOne: true;
            referencedRelation: "package_prices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "package_catalog_drafts_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
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
      operational_cost_ledger: {
        Row: {
          amount_delta_cents: number;
          campaign_id: string | null;
          cost_kind: string;
          created_at: string;
          currency: string;
          description: string;
          entry_kind: string;
          id: string;
          incurred_at: string;
          original_cost_id: string | null;
          recorded_by: string;
          request_id: string;
          student_id: string | null;
        };
        Insert: {
          amount_delta_cents: number;
          campaign_id?: string | null;
          cost_kind: string;
          created_at?: string;
          currency?: string;
          description: string;
          entry_kind: string;
          id?: string;
          incurred_at: string;
          original_cost_id?: string | null;
          recorded_by: string;
          request_id: string;
          student_id?: string | null;
        };
        Update: {
          amount_delta_cents?: number;
          campaign_id?: string | null;
          cost_kind?: string;
          created_at?: string;
          currency?: string;
          description?: string;
          entry_kind?: string;
          id?: string;
          incurred_at?: string;
          original_cost_id?: string | null;
          recorded_by?: string;
          request_id?: string;
          student_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "operational_cost_ledger_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "acquisition_campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_cost_ledger_original_cost_id_fkey";
            columns: ["original_cost_id"];
            isOneToOne: false;
            referencedRelation: "operational_cost_ledger";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_cost_ledger_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_cost_ledger_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
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
          checkout_v2_cycle_id: string | null;
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
          checkout_v2_cycle_id?: string | null;
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
          checkout_v2_cycle_id?: string | null;
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
            foreignKeyName: "payments_checkout_v2_cycle_id_fkey";
            columns: ["checkout_v2_cycle_id"];
            isOneToOne: false;
            referencedRelation: "checkout_v2_cycles";
            referencedColumns: ["id"];
          },
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
          checkout_v2_cycle_id: string | null;
          checkout_v2_cycle_session_index: number | null;
          checkout_v2_replacement_actor_id: string | null;
          checkout_v2_replacement_credit_adjustment_id: string | null;
          checkout_v2_replacement_reason: string | null;
          checkout_v2_replacement_request_id: string | null;
          checkout_v2_replacement_source_kind: string | null;
          checkout_v2_replaces_session_id: string | null;
          completed_at: string | null;
          created_at: string | null;
          drive_doc_id: string | null;
          drive_doc_url: string | null;
          duration_minutes: number;
          id: string;
          meet_link: string | null;
          no_show_at: string | null;
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
          checkout_v2_cycle_id?: string | null;
          checkout_v2_cycle_session_index?: number | null;
          checkout_v2_replacement_actor_id?: string | null;
          checkout_v2_replacement_credit_adjustment_id?: string | null;
          checkout_v2_replacement_reason?: string | null;
          checkout_v2_replacement_request_id?: string | null;
          checkout_v2_replacement_source_kind?: string | null;
          checkout_v2_replaces_session_id?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          drive_doc_id?: string | null;
          drive_doc_url?: string | null;
          duration_minutes?: number;
          id?: string;
          meet_link?: string | null;
          no_show_at?: string | null;
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
          checkout_v2_cycle_id?: string | null;
          checkout_v2_cycle_session_index?: number | null;
          checkout_v2_replacement_actor_id?: string | null;
          checkout_v2_replacement_credit_adjustment_id?: string | null;
          checkout_v2_replacement_reason?: string | null;
          checkout_v2_replacement_request_id?: string | null;
          checkout_v2_replacement_source_kind?: string | null;
          checkout_v2_replaces_session_id?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          drive_doc_id?: string | null;
          drive_doc_url?: string | null;
          duration_minutes?: number;
          id?: string;
          meet_link?: string | null;
          no_show_at?: string | null;
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
            foreignKeyName: "sessions_checkout_v2_cycle_id_fkey";
            columns: ["checkout_v2_cycle_id"];
            isOneToOne: false;
            referencedRelation: "checkout_v2_cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sessions_checkout_v2_replacement_actor_id_fkey";
            columns: ["checkout_v2_replacement_actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sessions_checkout_v2_replacement_credit_adjustment_id_fkey";
            columns: ["checkout_v2_replacement_credit_adjustment_id"];
            isOneToOne: true;
            referencedRelation: "checkout_v2_session_credit_adjustments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sessions_checkout_v2_replaces_session_id_fkey";
            columns: ["checkout_v2_replaces_session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
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
      stripe_payment_balance_transactions: {
        Row: {
          amount_cents: number;
          balance_type: string;
          currency: string;
          fee_cents: number;
          net_cents: number;
          observed_at: string;
          payment_id: string;
          reporting_category: string;
          source_id: string;
          source_kind: string;
          stripe_account_id: string;
          stripe_balance_transaction_id: string;
          stripe_created_at: string;
          stripe_livemode: boolean;
          stripe_payment_intent_id: string;
          stripe_type: string;
        };
        Insert: {
          amount_cents: number;
          balance_type: string;
          currency: string;
          fee_cents: number;
          net_cents: number;
          observed_at: string;
          payment_id: string;
          reporting_category: string;
          source_id: string;
          source_kind: string;
          stripe_account_id: string;
          stripe_balance_transaction_id: string;
          stripe_created_at: string;
          stripe_livemode: boolean;
          stripe_payment_intent_id: string;
          stripe_type: string;
        };
        Update: {
          amount_cents?: number;
          balance_type?: string;
          currency?: string;
          fee_cents?: number;
          net_cents?: number;
          observed_at?: string;
          payment_id?: string;
          reporting_category?: string;
          source_id?: string;
          source_kind?: string;
          stripe_account_id?: string;
          stripe_balance_transaction_id?: string;
          stripe_created_at?: string;
          stripe_livemode?: boolean;
          stripe_payment_intent_id?: string;
          stripe_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stripe_payment_balance_transactions_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      stripe_payment_fee_reconciliations: {
        Row: {
          created_at: string;
          last_attempted_at: string | null;
          last_error_code: string | null;
          payment_id: string;
          reconciled_amount_refunded_cents: number;
          reconciled_at: string | null;
          reconciled_transaction_count: number;
          status: string;
          stripe_account_id: string | null;
          stripe_livemode: boolean | null;
          stripe_payment_intent_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          last_attempted_at?: string | null;
          last_error_code?: string | null;
          payment_id: string;
          reconciled_amount_refunded_cents?: number;
          reconciled_at?: string | null;
          reconciled_transaction_count?: number;
          status?: string;
          stripe_account_id?: string | null;
          stripe_livemode?: boolean | null;
          stripe_payment_intent_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          last_attempted_at?: string | null;
          last_error_code?: string | null;
          payment_id?: string;
          reconciled_amount_refunded_cents?: number;
          reconciled_at?: string | null;
          reconciled_transaction_count?: number;
          status?: string;
          stripe_account_id?: string | null;
          stripe_livemode?: boolean | null;
          stripe_payment_intent_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stripe_payment_fee_reconciliations_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: true;
            referencedRelation: "payments";
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
      support_ticket_events: {
        Row: {
          actor_id: string | null;
          body: string | null;
          created_at: string;
          event_type: string;
          id: string;
          metadata: Json;
          sequence: number;
          ticket_id: string;
          visibility: string;
        };
        Insert: {
          actor_id?: string | null;
          body?: string | null;
          created_at?: string;
          event_type: string;
          id?: string;
          metadata?: Json;
          sequence: number;
          ticket_id: string;
          visibility: string;
        };
        Update: {
          actor_id?: string | null;
          body?: string | null;
          created_at?: string;
          event_type?: string;
          id?: string;
          metadata?: Json;
          sequence?: number;
          ticket_id?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_ticket_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_ticket_events_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      support_ticket_operations: {
        Row: {
          admin_id: string | null;
          assignment_is_set: boolean;
          created_at: string;
          expected_status: string;
          expected_updated_at: string;
          message_body: string | null;
          message_kind: string | null;
          request_id: string;
          requested_assigned_admin_id: string | null;
          requested_priority: string | null;
          requested_status: string | null;
          result: Json;
          ticket_id: string;
        };
        Insert: {
          admin_id?: string | null;
          assignment_is_set: boolean;
          created_at?: string;
          expected_status: string;
          expected_updated_at: string;
          message_body?: string | null;
          message_kind?: string | null;
          request_id: string;
          requested_assigned_admin_id?: string | null;
          requested_priority?: string | null;
          requested_status?: string | null;
          result: Json;
          ticket_id: string;
        };
        Update: {
          admin_id?: string | null;
          assignment_is_set?: boolean;
          created_at?: string;
          expected_status?: string;
          expected_updated_at?: string;
          message_body?: string | null;
          message_kind?: string | null;
          request_id?: string;
          requested_assigned_admin_id?: string | null;
          requested_priority?: string | null;
          requested_status?: string | null;
          result?: Json;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_ticket_operations_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_ticket_operations_requested_assigned_admin_id_fkey";
            columns: ["requested_assigned_admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_ticket_operations_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      support_tickets: {
        Row: {
          admin_notes: string | null;
          assigned_admin_id: string | null;
          context: Json;
          created_at: string;
          id: string;
          issue_title: string;
          issue_type: string;
          message: string;
          page_url: string | null;
          priority: string;
          status: string;
          updated_at: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          admin_notes?: string | null;
          assigned_admin_id?: string | null;
          context?: Json;
          created_at?: string;
          id?: string;
          issue_title: string;
          issue_type: string;
          message: string;
          page_url?: string | null;
          priority?: string;
          status?: string;
          updated_at?: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          admin_notes?: string | null;
          assigned_admin_id?: string | null;
          context?: Json;
          created_at?: string;
          id?: string;
          issue_title?: string;
          issue_type?: string;
          message?: string;
          page_url?: string | null;
          priority?: string;
          status?: string;
          updated_at?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_tickets_assigned_admin_id_fkey";
            columns: ["assigned_admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_tickets_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      teacher_compensation_cycle_terms: {
        Row: {
          active_students_observed: number;
          currency: string;
          cycle_id: string;
          external_class_rate_cents: number;
          founder_class_rate_cents: number;
          policy_version: number;
          rate_basis: string;
          snapshotted_at: string;
          threshold_effective_at: string | null;
        };
        Insert: {
          active_students_observed: number;
          currency: string;
          cycle_id: string;
          external_class_rate_cents: number;
          founder_class_rate_cents: number;
          policy_version?: number;
          rate_basis: string;
          snapshotted_at?: string;
          threshold_effective_at?: string | null;
        };
        Update: {
          active_students_observed?: number;
          currency?: string;
          cycle_id?: string;
          external_class_rate_cents?: number;
          founder_class_rate_cents?: number;
          policy_version?: number;
          rate_basis?: string;
          snapshotted_at?: string;
          threshold_effective_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_compensation_cycle_terms_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: true;
            referencedRelation: "checkout_v2_cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_cycle_terms_policy_version_fkey";
            columns: ["policy_version"];
            isOneToOne: false;
            referencedRelation: "teacher_compensation_policy_versions";
            referencedColumns: ["version"];
          },
        ];
      };
      teacher_compensation_engagements: {
        Row: {
          configured_by: string;
          created_at: string;
          effective_from: string;
          engagement_kind: string;
          id: string;
          reason: string;
          request_id: string;
          teacher_id: string;
        };
        Insert: {
          configured_by: string;
          created_at?: string;
          effective_from: string;
          engagement_kind: string;
          id?: string;
          reason: string;
          request_id: string;
          teacher_id: string;
        };
        Update: {
          configured_by?: string;
          created_at?: string;
          effective_from?: string;
          engagement_kind?: string;
          id?: string;
          reason?: string;
          request_id?: string;
          teacher_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_compensation_engagements_configured_by_fkey";
            columns: ["configured_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_engagements_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      teacher_compensation_work_adjustments: {
        Row: {
          amount_delta_cents: number;
          created_at: string;
          currency: string;
          id: string;
          minutes_delta: number;
          policy_version: number;
          rate_cents_per_minute: number;
          reason: string;
          recorded_by: string;
          request_id: string;
          teacher_id: string;
          work_entry_id: string;
        };
        Insert: {
          amount_delta_cents: number;
          created_at?: string;
          currency: string;
          id?: string;
          minutes_delta: number;
          policy_version?: number;
          rate_cents_per_minute: number;
          reason: string;
          recorded_by: string;
          request_id: string;
          teacher_id: string;
          work_entry_id: string;
        };
        Update: {
          amount_delta_cents?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          minutes_delta?: number;
          policy_version?: number;
          rate_cents_per_minute?: number;
          reason?: string;
          recorded_by?: string;
          request_id?: string;
          teacher_id?: string;
          work_entry_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_compensation_work_adjustments_policy_version_fkey";
            columns: ["policy_version"];
            isOneToOne: false;
            referencedRelation: "teacher_compensation_policy_versions";
            referencedColumns: ["version"];
          },
          {
            foreignKeyName: "teacher_compensation_work_adjustments_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_work_adjustments_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_work_adjustment_identity_fkey";
            columns: ["work_entry_id", "teacher_id"];
            isOneToOne: false;
            referencedRelation: "teacher_compensation_work_ledger";
            referencedColumns: ["id", "teacher_id"];
          },
        ];
      };
      teacher_compensation_ledger: {
        Row: {
          amount_cents: number;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          class_rate_cents: number;
          completed_at: string | null;
          created_at: string;
          currency: string;
          cycle_id: string;
          cycle_terms_id: string;
          engagement_id: string;
          engagement_kind: string;
          event_kind: string;
          id: string;
          idempotency_key: string;
          no_show_at: string | null;
          scheduled_at: string;
          session_id: string;
          session_status: string;
          source_occurred_at: string;
          student_id: string;
          subscription_id: string;
          teacher_id: string;
        };
        Insert: {
          amount_cents: number;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          class_rate_cents: number;
          completed_at?: string | null;
          created_at?: string;
          currency: string;
          cycle_id: string;
          cycle_terms_id: string;
          engagement_id: string;
          engagement_kind: string;
          event_kind: string;
          id?: string;
          idempotency_key: string;
          no_show_at?: string | null;
          scheduled_at: string;
          session_id: string;
          session_status: string;
          source_occurred_at: string;
          student_id: string;
          subscription_id: string;
          teacher_id: string;
        };
        Update: {
          amount_cents?: number;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          class_rate_cents?: number;
          completed_at?: string | null;
          created_at?: string;
          currency?: string;
          cycle_id?: string;
          cycle_terms_id?: string;
          engagement_id?: string;
          engagement_kind?: string;
          event_kind?: string;
          id?: string;
          idempotency_key?: string;
          no_show_at?: string | null;
          scheduled_at?: string;
          session_id?: string;
          session_status?: string;
          source_occurred_at?: string;
          student_id?: string;
          subscription_id?: string;
          teacher_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_compensation_ledger_cancelled_by_fkey";
            columns: ["cancelled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_ledger_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "checkout_v2_cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_ledger_cycle_terms_id_fkey";
            columns: ["cycle_terms_id"];
            isOneToOne: false;
            referencedRelation: "teacher_compensation_cycle_terms";
            referencedColumns: ["cycle_id"];
          },
          {
            foreignKeyName: "teacher_compensation_ledger_engagement_id_fkey";
            columns: ["engagement_id"];
            isOneToOne: false;
            referencedRelation: "teacher_compensation_engagements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_ledger_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_ledger_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_ledger_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_ledger_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      teacher_compensation_settlement_lines: {
        Row: {
          amount_cents: number;
          created_at: string;
          currency: string;
          description: string;
          id: string;
          quantity_minutes: number | null;
          settlement_id: string;
          source_id: string;
          source_kind: string;
          source_occurred_at: string;
          student_id: string | null;
          teacher_id: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          currency: string;
          description: string;
          id?: string;
          quantity_minutes?: number | null;
          settlement_id: string;
          source_id: string;
          source_kind: string;
          source_occurred_at: string;
          student_id?: string | null;
          teacher_id: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          description?: string;
          id?: string;
          quantity_minutes?: number | null;
          settlement_id?: string;
          source_id?: string;
          source_kind?: string;
          source_occurred_at?: string;
          student_id?: string | null;
          teacher_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_compensation_settlement_line_identity_fkey";
            columns: ["settlement_id", "teacher_id"];
            isOneToOne: false;
            referencedRelation: "teacher_compensation_settlements";
            referencedColumns: ["id", "teacher_id"];
          },
          {
            foreignKeyName: "teacher_compensation_settlement_lines_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_settlement_lines_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      teacher_compensation_settlement_payment_voids: {
        Row: {
          created_at: string;
          id: string;
          payment_id: string;
          reason: string;
          request_id: string;
          settlement_id: string;
          teacher_id: string;
          voided_by: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          payment_id: string;
          reason: string;
          request_id: string;
          settlement_id: string;
          teacher_id: string;
          voided_by: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          payment_id?: string;
          reason?: string;
          request_id?: string;
          settlement_id?: string;
          teacher_id?: string;
          voided_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_compensation_settlement_payment_void_identity_fkey";
            columns: ["payment_id", "settlement_id", "teacher_id"];
            isOneToOne: true;
            referencedRelation: "teacher_compensation_settlement_payments";
            referencedColumns: ["id", "settlement_id", "teacher_id"];
          },
          {
            foreignKeyName: "teacher_compensation_settlement_payment_voids_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_settlement_payment_voids_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      teacher_compensation_settlement_payments: {
        Row: {
          amount_cents: number;
          created_at: string;
          currency: string;
          id: string;
          invoice_reference: string | null;
          note: string;
          paid_at: string;
          payment_reference: string;
          recorded_by: string;
          request_id: string;
          settlement_id: string;
          teacher_id: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          currency: string;
          id?: string;
          invoice_reference?: string | null;
          note: string;
          paid_at: string;
          payment_reference: string;
          recorded_by: string;
          request_id: string;
          settlement_id: string;
          teacher_id: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          invoice_reference?: string | null;
          note?: string;
          paid_at?: string;
          payment_reference?: string;
          recorded_by?: string;
          request_id?: string;
          settlement_id?: string;
          teacher_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_compensation_settlement_payment_identity_fkey";
            columns: ["settlement_id", "teacher_id"];
            isOneToOne: false;
            referencedRelation: "teacher_compensation_settlements";
            referencedColumns: ["id", "teacher_id"];
          },
          {
            foreignKeyName: "teacher_compensation_settlement_payments_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_settlement_payments_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      teacher_compensation_settlements: {
        Row: {
          adjustment_amount_cents: number;
          class_amount_cents: number;
          close_note: string;
          closed_at: string;
          closed_by: string;
          currency: string;
          id: string;
          line_count: number;
          mandatory_work_amount_cents: number;
          period_end_at: string;
          period_month: string;
          period_start_at: string;
          request_id: string;
          teacher_id: string;
          timezone: string;
          total_amount_cents: number;
        };
        Insert: {
          adjustment_amount_cents: number;
          class_amount_cents: number;
          close_note: string;
          closed_at?: string;
          closed_by: string;
          currency: string;
          id?: string;
          line_count: number;
          mandatory_work_amount_cents: number;
          period_end_at: string;
          period_month: string;
          period_start_at: string;
          request_id: string;
          teacher_id: string;
          timezone?: string;
          total_amount_cents: number;
        };
        Update: {
          adjustment_amount_cents?: number;
          class_amount_cents?: number;
          close_note?: string;
          closed_at?: string;
          closed_by?: string;
          currency?: string;
          id?: string;
          line_count?: number;
          mandatory_work_amount_cents?: number;
          period_end_at?: string;
          period_month?: string;
          period_start_at?: string;
          request_id?: string;
          teacher_id?: string;
          timezone?: string;
          total_amount_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_compensation_settlements_closed_by_fkey";
            columns: ["closed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_settlements_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      teacher_compensation_milestones: {
        Row: {
          created_at: string;
          first_ready_initial_at: string | null;
          first_ready_initial_cycle_id: string | null;
          policy_version: number;
          ten_active_bootstrap_request_id: string | null;
          ten_active_confirmation_reason: string | null;
          ten_active_confirmed_by: string | null;
          ten_active_history_confirmation: string | null;
          ten_active_history_state: string;
          ten_active_reached_at: string | null;
          ten_active_students_count: number | null;
          ten_active_trigger_cycle_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          first_ready_initial_at?: string | null;
          first_ready_initial_cycle_id?: string | null;
          policy_version: number;
          ten_active_bootstrap_request_id?: string | null;
          ten_active_confirmation_reason?: string | null;
          ten_active_confirmed_by?: string | null;
          ten_active_history_confirmation?: string | null;
          ten_active_history_state: string;
          ten_active_reached_at?: string | null;
          ten_active_students_count?: number | null;
          ten_active_trigger_cycle_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          first_ready_initial_at?: string | null;
          first_ready_initial_cycle_id?: string | null;
          policy_version?: number;
          ten_active_bootstrap_request_id?: string | null;
          ten_active_confirmation_reason?: string | null;
          ten_active_confirmed_by?: string | null;
          ten_active_history_confirmation?: string | null;
          ten_active_history_state?: string;
          ten_active_reached_at?: string | null;
          ten_active_students_count?: number | null;
          ten_active_trigger_cycle_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_compensation_milestones_first_ready_initial_cycle_id_fkey";
            columns: ["first_ready_initial_cycle_id"];
            isOneToOne: true;
            referencedRelation: "checkout_v2_cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_milestones_policy_version_fkey";
            columns: ["policy_version"];
            isOneToOne: true;
            referencedRelation: "teacher_compensation_policy_versions";
            referencedColumns: ["version"];
          },
          {
            foreignKeyName: "teacher_compensation_milestones_ten_active_confirmed_by_fkey";
            columns: ["ten_active_confirmed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_milestones_ten_active_trigger_cycle_id_fkey";
            columns: ["ten_active_trigger_cycle_id"];
            isOneToOne: true;
            referencedRelation: "checkout_v2_cycles";
            referencedColumns: ["id"];
          },
        ];
      };
      teacher_compensation_policy_versions: {
        Row: {
          active_student_threshold: number;
          created_at: string;
          currency: string;
          elapsed_day_threshold: number;
          external_initial_class_rate_cents: number;
          external_raised_class_rate_cents: number;
          founder_class_rate_cents: number;
          mandatory_work_rate_cents_per_hour: number;
          mandatory_work_rate_cents_per_minute: number;
          version: number;
        };
        Insert: {
          active_student_threshold: number;
          created_at?: string;
          currency: string;
          elapsed_day_threshold: number;
          external_initial_class_rate_cents: number;
          external_raised_class_rate_cents: number;
          founder_class_rate_cents: number;
          mandatory_work_rate_cents_per_hour: number;
          mandatory_work_rate_cents_per_minute: number;
          version: number;
        };
        Update: {
          active_student_threshold?: number;
          created_at?: string;
          currency?: string;
          elapsed_day_threshold?: number;
          external_initial_class_rate_cents?: number;
          external_raised_class_rate_cents?: number;
          founder_class_rate_cents?: number;
          mandatory_work_rate_cents_per_hour?: number;
          mandatory_work_rate_cents_per_minute?: number;
          version?: number;
        };
        Relationships: [];
      };
      teacher_compensation_work_ledger: {
        Row: {
          amount_cents: number;
          created_at: string;
          currency: string;
          description: string;
          duration_minutes: number;
          ended_at: string;
          engagement_id: string;
          engagement_kind: string;
          id: string;
          policy_version: number;
          rate_cents_per_minute: number;
          recorded_by: string;
          request_id: string;
          started_at: string;
          teacher_id: string;
          work_kind: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          currency: string;
          description: string;
          duration_minutes: number;
          ended_at: string;
          engagement_id: string;
          engagement_kind: string;
          id?: string;
          policy_version?: number;
          rate_cents_per_minute: number;
          recorded_by: string;
          request_id: string;
          started_at: string;
          teacher_id: string;
          work_kind: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          description?: string;
          duration_minutes?: number;
          ended_at?: string;
          engagement_id?: string;
          engagement_kind?: string;
          id?: string;
          policy_version?: number;
          rate_cents_per_minute?: number;
          recorded_by?: string;
          request_id?: string;
          started_at?: string;
          teacher_id?: string;
          work_kind?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_compensation_work_engagement_identity_fkey";
            columns: ["engagement_id", "teacher_id", "engagement_kind"];
            isOneToOne: false;
            referencedRelation: "teacher_compensation_engagements";
            referencedColumns: ["id", "teacher_id", "engagement_kind"];
          },
          {
            foreignKeyName: "teacher_compensation_work_ledger_policy_version_fkey";
            columns: ["policy_version"];
            isOneToOne: false;
            referencedRelation: "teacher_compensation_policy_versions";
            referencedColumns: ["version"];
          },
          {
            foreignKeyName: "teacher_compensation_work_ledger_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_work_ledger_teacher_id_fkey";
            columns: ["teacher_id"];
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
      acquisition_allocation_candidates: {
        Row: {
          active_campaign_id: string | null;
          active_campaign_name: string | null;
          basis_candidate: string | null;
          checkout_attribution_event_id: string | null;
          checkout_intent_id: string | null;
          contact_id: string | null;
          first_cycle_id: string | null;
          first_paid_at: string | null;
          first_payment_id: string | null;
          first_subscription_id: string | null;
          has_active_allocation: boolean | null;
          matched_campaign_id: string | null;
          matched_campaign_name: string | null;
          student_email: string | null;
          student_full_name: string | null;
          student_id: string;
          utm_campaign: string | null;
          utm_content: string | null;
          utm_medium: string | null;
          utm_source: string | null;
          utm_term: string | null;
        };
        Relationships: [];
      };
      acquisition_campaign_unit_economics: {
        Row: {
          acquired_student_count: number | null;
          allocated_acquisition_cost_cents: number | null;
          attribution_mode: string | null;
          campaign_id: string;
          campaign_name: string | null;
          campaign_spend_cents: number | null;
          created_at: string | null;
          currency: string | null;
          direct_operational_cost_cents: number | null;
          gross_revenue_cents: number | null;
          net_revenue_cents: number | null;
          provider: string | null;
          provisional_contribution_cents: number | null;
          refunds_cents: number | null;
          stripe_fee_cents: number | null;
          stripe_fee_reconciliation_status: string | null;
          teacher_compensation_cents: number | null;
          unreconciled_payment_count: number | null;
          unallocated_spend_cents: number | null;
          utm_campaign: string | null;
          utm_content: string | null;
          utm_medium: string | null;
          utm_source: string | null;
          utm_term: string | null;
        };
        Relationships: [];
      };
      acquisition_cost_allocation_balances: {
        Row: {
          adjustment_amount_cents: number | null;
          allocated_by: string | null;
          balance_amount_cents: number | null;
          basis: string | null;
          campaign_id: string;
          checkout_attribution_event_id: string | null;
          checkout_intent_id: string | null;
          contact_id: string | null;
          created_at: string | null;
          currency: string | null;
          first_cycle_id: string | null;
          first_subscription_id: string | null;
          last_adjusted_at: string | null;
          original_allocation_id: string;
          original_amount_cents: number | null;
          reason: string | null;
          request_id: string | null;
          student_id: string;
        };
        Relationships: [];
      };
      checkout_v2_cycle_progress: {
        Row: {
          cycle_id: string | null;
          cycle_kind: string | null;
          cycle_number: number | null;
          ends_at: string | null;
          materialization_state: string | null;
          progress_state: string | null;
          sessions_completed: number | null;
          sessions_consumed: number | null;
          sessions_late_student_cancelled: number | null;
          sessions_materialized: number | null;
          sessions_materialized_at: string | null;
          sessions_no_show: number | null;
          sessions_remaining: number | null;
          sessions_restored: number | null;
          sessions_scheduled: number | null;
          sessions_total: number | null;
          starts_at: string | null;
          student_id: string | null;
          subscription_id: string | null;
        };
        Relationships: [];
      };
      checkout_v2_session_consumption: {
        Row: {
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          completed_at: string | null;
          consumption_kind: string | null;
          credit_adjustment_id: string | null;
          credit_adjustment_request_id: string | null;
          credit_restored: boolean | null;
          credit_restored_at: string | null;
          cycle_id: string | null;
          cycle_number: number | null;
          no_show_at: string | null;
          original_consumption_kind: string | null;
          original_student_credit_consumed: boolean | null;
          scheduled_at: string | null;
          session_id: string | null;
          session_index: number | null;
          session_status: string | null;
          student_credit_consumed: boolean | null;
          subscription_id: string | null;
        };
        Relationships: [];
      };
      operational_cost_balances: {
        Row: {
          adjustment_amount_cents: number | null;
          balance_amount_cents: number | null;
          campaign_id: string | null;
          cost_kind: string | null;
          created_at: string | null;
          currency: string | null;
          description: string | null;
          incurred_at: string | null;
          last_adjusted_at: string | null;
          original_amount_cents: number | null;
          original_cost_id: string | null;
          recorded_by: string | null;
          request_id: string | null;
          student_id: string | null;
        };
        Relationships: [];
      };
      portfolio_unit_economics: {
        Row: {
          allocated_acquisition_cost_cents: number | null;
          campaign_spend_cents: number | null;
          currency: string | null;
          direct_operational_cost_cents: number | null;
          gross_revenue_cents: number | null;
          net_revenue_cents: number | null;
          portfolio_key: string | null;
          provisional_contribution_cents: number | null;
          refunds_cents: number | null;
          stripe_fee_cents: number | null;
          stripe_fee_reconciliation_status: string | null;
          student_count: number | null;
          teacher_compensation_cents: number | null;
          unreconciled_payment_count: number | null;
          unallocated_acquisition_cost_cents: number | null;
        };
        Relationships: [];
      };
      stripe_payment_fee_status: {
        Row: {
          amount_refunded_cents: number | null;
          checkout_v2_cycle_id: string | null;
          currency: string | null;
          gross_amount_cents: number | null;
          last_attempted_at: string | null;
          last_error_code: string | null;
          payment_id: string | null;
          reconciled_at: string | null;
          reconciled_transaction_count: number | null;
          reconciliation_status: string | null;
          stripe_fee_cents: number | null;
          stripe_payment_intent_id: string | null;
          student_id: string | null;
          subscription_id: string | null;
        };
        Relationships: [];
      };
      student_unit_economics: {
        Row: {
          acquisition_basis: string | null;
          acquisition_cost_cents: number | null;
          active_campaign_id: string | null;
          active_campaign_name: string | null;
          currency: string | null;
          direct_operational_cost_cents: number | null;
          first_cycle_id: string | null;
          first_paid_at: string | null;
          gross_revenue_cents: number | null;
          net_revenue_cents: number | null;
          paid_cycle_count: number | null;
          provisional_contribution_cents: number | null;
          refunds_cents: number | null;
          stripe_fee_cents: number | null;
          stripe_fee_reconciliation_status: string | null;
          student_email: string | null;
          student_full_name: string | null;
          student_id: string;
          subscription_count: number | null;
          teacher_compensation_cents: number | null;
          unreconciled_payment_count: number | null;
        };
        Relationships: [];
      };
      teacher_compensation_session_reconciliation_candidates: {
        Row: {
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          completed_at: string | null;
          cycle_id: string | null;
          duration_minutes: number;
          event_kind: string | null;
          no_show_at: string | null;
          scheduled_at: string | null;
          session_id: string;
          source_occurred_at: string | null;
          status: string;
          student_email: string;
          student_full_name: string | null;
          student_id: string;
          subscription_id: string;
          teacher_email: string | null;
          teacher_full_name: string | null;
          teacher_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sessions_checkout_v2_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "checkout_v2_cycles";
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
      teacher_compensation_settlement_balances: {
        Row: {
          adjustment_amount_cents: number | null;
          class_amount_cents: number | null;
          close_note: string | null;
          closed_at: string | null;
          closed_by: string | null;
          currency: string | null;
          id: string | null;
          invoice_reference: string | null;
          line_count: number | null;
          mandatory_work_amount_cents: number | null;
          paid_at: string | null;
          payment_id: string | null;
          payment_note: string | null;
          payment_recorded_by: string | null;
          payment_reference: string | null;
          period_end_at: string | null;
          period_month: string | null;
          period_start_at: string | null;
          request_id: string | null;
          status: string | null;
          teacher_id: string | null;
          timezone: string | null;
          total_amount_cents: number | null;
        };
        Relationships: [];
      };
      teacher_compensation_work_balances: {
        Row: {
          adjusted_amount_cents: number;
          adjusted_minutes: number;
          adjustment_amount_cents: number;
          adjustment_minutes: number;
          amount_cents: number;
          created_at: string;
          currency: string;
          description: string;
          duration_minutes: number;
          ended_at: string;
          engagement_id: string;
          engagement_kind: string;
          id: string;
          policy_version: number;
          rate_cents_per_minute: number;
          recorded_by: string;
          request_id: string;
          started_at: string;
          teacher_id: string;
          work_kind: string;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_compensation_work_engagement_identity_fkey";
            columns: ["engagement_id", "teacher_id", "engagement_kind"];
            isOneToOne: false;
            referencedRelation: "teacher_compensation_engagements";
            referencedColumns: ["id", "teacher_id", "engagement_kind"];
          },
          {
            foreignKeyName: "teacher_compensation_work_ledger_policy_version_fkey";
            columns: ["policy_version"];
            isOneToOne: false;
            referencedRelation: "teacher_compensation_policy_versions";
            referencedColumns: ["version"];
          },
          {
            foreignKeyName: "teacher_compensation_work_ledger_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_compensation_work_ledger_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      admin_grant_access_role: {
        Args: {
          p_access_role: Database["public"]["Enums"]["admin_access_role"];
          p_actor_id: string;
          p_profile_id: string;
        };
        Returns: Json;
      };
      admin_mutate_support_ticket: {
        Args: {
          p_admin_id: string;
          p_assigned_admin_id?: string | null;
          p_assignment_is_set?: boolean;
          p_expected_status: string;
          p_expected_updated_at: string;
          p_message_body?: string | null;
          p_message_kind?: string | null;
          p_new_priority?: string | null;
          p_new_status?: string | null;
          p_request_id: string;
          p_ticket_id: string;
        };
        Returns: Json;
      };
      admin_revoke_access_role: {
        Args: {
          p_access_role: Database["public"]["Enums"]["admin_access_role"];
          p_actor_id: string;
          p_profile_id: string;
        };
        Returns: Json;
      };
      get_my_support_ticket_events: {
        Args: {
          p_before_sequence?: number | null;
          p_limit?: number;
          p_ticket_id: string;
        };
        Returns: {
          body: string | null;
          created_at: string;
          event_type: string;
          id: string;
          sequence: number;
          ticket_id: string;
        }[];
      };
      get_my_admin_capabilities: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["admin_capability"][];
      };
      get_my_support_tickets: {
        Args: { p_limit?: number; p_offset?: number };
        Returns: {
          created_at: string;
          id: string;
          issue_title: string;
          issue_type: string;
          message: string;
          priority: string;
          status: string;
          updated_at: string;
        }[];
      };
      has_my_admin_capability: {
        Args: {
          p_capability: Database["public"]["Enums"]["admin_capability"];
        };
        Returns: boolean;
      };
      activate_teacher_profile: {
        Args: {
          p_admin_id: string;
          p_effective_from: string;
          p_engagement_kind: string;
          p_profile_id: string;
          p_reason: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      adjust_acquisition_cost_allocation: {
        Args: {
          p_admin_id: string;
          p_amount_delta_cents: number;
          p_original_allocation_id: string;
          p_reason: string;
          p_request_id: string;
        };
        Returns: Database["public"]["Tables"]["acquisition_cost_allocation_ledger"]["Row"];
        SetofOptions: {
          from: "*";
          to: "acquisition_cost_allocation_ledger";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      adjust_operational_cost: {
        Args: {
          p_admin_id: string;
          p_amount_delta_cents: number;
          p_original_cost_id: string;
          p_reason: string;
          p_request_id: string;
        };
        Returns: Database["public"]["Tables"]["operational_cost_ledger"]["Row"];
        SetofOptions: {
          from: "*";
          to: "operational_cost_ledger";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      admin_create_bookable_slot: {
        Args: {
          p_admin_id: string;
          p_occurrences: string[];
          p_package_id: string;
          p_reason: string;
          p_request_id: string;
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
      admin_recover_fulfillment_job: {
        Args: {
          p_action: string;
          p_admin_id: string;
          p_job_id: string;
        };
        Returns: Database["public"]["Tables"]["fulfillment_jobs"]["Row"];
        SetofOptions: {
          from: "*";
          to: "fulfillment_jobs";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      admin_transition_bookable_slot: {
        Args: {
          p_admin_id: string;
          p_reason: string;
          p_request_id: string;
          p_slot_id: string;
          p_transition: string;
        };
        Returns: Database["public"]["Tables"]["bookable_slots"]["Row"];
        SetofOptions: {
          from: "*";
          to: "bookable_slots";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      get_checkout_v2_subscription_progress: {
        Args: { p_subscription_id: string };
        Returns: {
          cycle_id: string;
          cycle_kind: string;
          cycle_number: number;
          ends_at: string;
          materialization_state: string;
          progress_state: string;
          sessions_completed: number | null;
          sessions_consumed: number | null;
          sessions_late_student_cancelled: number | null;
          sessions_materialized: number;
          sessions_materialized_at: string | null;
          sessions_no_show: number | null;
          sessions_remaining: number | null;
          sessions_restored: number | null;
          sessions_scheduled: number | null;
          sessions_total: number;
          starts_at: string;
          student_id: string;
          subscription_id: string;
        }[];
      };
      get_checkout_v2_subscriptions_progress: {
        Args: { p_subscription_ids: string[] };
        Returns: {
          cycle_id: string;
          cycle_kind: string;
          cycle_number: number;
          ends_at: string;
          materialization_state: string;
          progress_state: string;
          sessions_completed: number | null;
          sessions_consumed: number | null;
          sessions_late_student_cancelled: number | null;
          sessions_materialized: number;
          sessions_materialized_at: string | null;
          sessions_no_show: number | null;
          sessions_remaining: number | null;
          sessions_restored: number | null;
          sessions_scheduled: number | null;
          sessions_total: number;
          starts_at: string;
          student_id: string;
          subscription_id: string;
        }[];
      };
      adjust_teacher_compensation_work: {
        Args: {
          p_minutes_delta: number;
          p_reason: string;
          p_recorded_by: string;
          p_request_id: string;
          p_work_entry_id: string;
        };
        Returns: Database["public"]["Tables"]["teacher_compensation_work_adjustments"]["Row"];
        SetofOptions: {
          from: "*";
          to: "teacher_compensation_work_adjustments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_acquisition_campaign: {
        Args: {
          p_admin_id: string;
          p_external_reference: string | null;
          p_name: string;
          p_provider: string;
          p_request_id: string;
          p_utm_campaign: string | null;
          p_utm_content: string | null;
          p_utm_medium: string | null;
          p_utm_source: string | null;
          p_utm_term: string | null;
        };
        Returns: Database["public"]["Tables"]["acquisition_campaigns"]["Row"];
        SetofOptions: {
          from: "*";
          to: "acquisition_campaigns";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      apply_checkout_v2_guarantee_termination: {
        Args: {
          p_operation_id: string;
          p_stripe_cancelled_at: string;
          p_worker_token: string;
        };
        Returns: Database["public"]["Tables"]["checkout_v2_guarantee_operations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_guarantee_operations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      begin_checkout_v2_guarantee_cancellation: {
        Args: { p_operation_id: string; p_worker_token: string };
        Returns: Database["public"]["Tables"]["checkout_v2_guarantee_operations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_guarantee_operations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      begin_checkout_v2_guarantee_refund: {
        Args: { p_operation_id: string; p_worker_token: string };
        Returns: Database["public"]["Tables"]["checkout_v2_guarantee_operations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_guarantee_operations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      claim_checkout_v2_guarantee: {
        Args: { p_operation_id: string; p_worker_token: string };
        Returns: Database["public"]["Tables"]["checkout_v2_guarantee_operations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_guarantee_operations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      excuse_checkout_v2_guarantee_incident: {
        Args: { p_admin_id: string; p_reason: string; p_session_id: string };
        Returns: Database["public"]["Tables"]["checkout_v2_session_incident_resolutions"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_session_incident_resolutions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      get_checkout_v2_guarantee_state: {
        Args: { p_actor_id: string; p_subscription_id: string };
        Returns: {
          cycle_id: string;
          currency: string;
          operation_id: string;
          reason: string;
          refund_amount_cents: number;
          sessions_consumed: number;
          sessions_refundable: number;
          sessions_total: number;
          state: string;
          subscription_id: string;
          updated_at: string;
        }[];
      };
      mark_checkout_v2_guarantee_outcome: {
        Args: {
          p_error: string;
          p_operation_id: string;
          p_status: string;
          p_worker_token: string;
        };
        Returns: Database["public"]["Tables"]["checkout_v2_guarantee_operations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_guarantee_operations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      observe_checkout_v2_guarantee_refund: {
        Args: {
          p_amount_cents: number;
          p_currency: string;
          p_operation_id: string;
          p_refund_created_at: string;
          p_refund_status: string;
          p_stripe_payment_intent_id: string;
          p_stripe_refund_id: string;
        };
        Returns: Database["public"]["Tables"]["checkout_v2_guarantee_operations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_guarantee_operations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      prepare_checkout_v2_guarantee: {
        Args: { p_actor_id: string; p_request_id: string; p_subscription_id: string };
        Returns: Database["public"]["Tables"]["checkout_v2_guarantee_operations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_guarantee_operations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      resolve_checkout_v2_guarantee_review: {
        Args: { p_admin_id: string; p_operation_id: string; p_reason: string };
        Returns: Database["public"]["Tables"]["checkout_v2_guarantee_operations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_guarantee_operations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
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
      apply_checkout_v2_renewal: {
        Args: {
          p_payment_id: string;
          p_period_end: string;
          p_period_start: string;
          p_recurring_stripe_price_id: string;
          p_stripe_invoice_id: string;
          p_stripe_subscription_id: string;
          p_subscription_id: string;
        };
        Returns: boolean;
      };
      apply_checkout_v2_reschedule: {
        Args: {
          p_observed_stripe_anchor_at?: string | null;
          p_operation_id: string;
        };
        Returns: Database["public"]["Tables"]["checkout_v2_reschedule_operations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_reschedule_operations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      begin_checkout_v2_reschedule_stripe_mutation: {
        Args: { p_operation_id: string };
        Returns: Database["public"]["Tables"]["checkout_v2_reschedule_operations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_reschedule_operations";
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
          p_hold_fingerprint: string;
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
      claim_direct_checkout_intent_for_slot: {
        Args: {
          p_full_name: string | null;
          p_hold_fingerprint: string;
          p_lang: string;
          p_legal_policy_version: string;
          p_package_price_id: string;
          p_primary_email: string;
          p_site_url: string;
          p_slot_public_id: string;
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
      confirm_teacher_compensation_ten_active_history: {
        Args: {
          p_admin_id: string;
          p_confirmation: string;
          p_observed_count: number | null;
          p_reason: string;
          p_request_id: string;
          p_trigger_cycle_id: string | null;
        };
        Returns: Database["public"]["Tables"]["teacher_compensation_milestones"]["Row"];
        SetofOptions: {
          from: "*";
          to: "teacher_compensation_milestones";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      configure_teacher_compensation_engagement: {
        Args: {
          p_configured_by: string;
          p_effective_from: string;
          p_engagement_kind: string;
          p_reason: string;
          p_request_id: string;
          p_teacher_id: string;
        };
        Returns: Database["public"]["Tables"]["teacher_compensation_engagements"]["Row"];
        SetofOptions: {
          from: "*";
          to: "teacher_compensation_engagements";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      close_teacher_compensation_settlement: {
        Args: {
          p_admin_id: string;
          p_close_note: string;
          p_period_month: string;
          p_request_id: string;
          p_teacher_id: string;
        };
        Returns: Database["public"]["Tables"]["teacher_compensation_settlements"]["Row"];
        SetofOptions: {
          from: "*";
          to: "teacher_compensation_settlements";
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
      create_cms_content_draft: {
        Args: {
          p_actor_id: string;
          p_content_key: string;
          p_initial_payload: Json;
          p_locale: Database["public"]["Enums"]["cms_content_locale"];
        };
        Returns: Database["public"]["Tables"]["cms_content_drafts"]["Row"];
        SetofOptions: {
          from: "*";
          to: "cms_content_drafts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_package_catalog_draft: {
        Args: {
          p_actor_id: string;
          p_amount_cents?: number | null;
          p_billing_interval_count?: number | null;
          p_billing_interval_unit?: string | null;
          p_class_duration_minutes?: number | null;
          p_display_name?: Json | null;
          p_has_dual_teacher?: boolean;
          p_has_group_session?: boolean;
          p_is_publicly_listed?: boolean;
          p_package_id?: string | null;
          p_package_key?: string | null;
          p_sessions_per_period?: number | null;
        };
        Returns: Database["public"]["Tables"]["package_catalog_drafts"]["Row"];
        SetofOptions: {
          from: "*";
          to: "package_catalog_drafts";
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
      discard_cms_content_draft: {
        Args: {
          p_actor_id: string;
          p_draft_id: string;
          p_expected_revision: number;
        };
        Returns: Database["public"]["Tables"]["cms_content_drafts"]["Row"];
        SetofOptions: {
          from: "*";
          to: "cms_content_drafts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      discard_package_catalog_draft: {
        Args: {
          p_actor_id: string;
          p_draft_id: string;
          p_expected_revision: number;
        };
        Returns: Database["public"]["Tables"]["package_catalog_drafts"]["Row"];
        SetofOptions: {
          from: "*";
          to: "package_catalog_drafts";
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
      fix_checkout_v2_billing_anchor: {
        Args: {
          p_fixed_at: string;
          p_subscription_id: string;
        };
        Returns: Database["public"]["Tables"]["checkout_v2_billing_state"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_billing_state";
          isOneToOne: true;
          isSetofReturn: false;
        };
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
          p_hold_fingerprint: string;
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
      initialize_checkout_v2_billing: {
        Args: {
          p_first_session_id: string;
          p_initial_payment_id: string;
          p_initial_stripe_price_id: string;
          p_stripe_renewal_anchor_at: string;
          p_subscription_id: string;
        };
        Returns: Database["public"]["Tables"]["checkout_v2_billing_state"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_billing_state";
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
      list_checkout_v2_reschedule_targets: {
        Args: {
          p_actor_id: string;
          p_from: string;
          p_ignored_pending_request_id?: string | null;
          p_session_id: string;
          p_to: string;
        };
        Returns: {
          affected_scheduled_ats: string[];
          operation_kind: string;
          target_scheduled_at: string;
        }[];
      };
      materialize_checkout_v2_cycle_sessions: {
        Args: {
          p_stripe_invoice_id: string;
          p_subscription_id: string;
        };
        Returns: Database["public"]["Tables"]["checkout_v2_cycles"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_cycles";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      publish_cms_content_draft: {
        Args: {
          p_actor_id: string;
          p_draft_id: string;
          p_expected_revision: number;
        };
        Returns: Database["public"]["Tables"]["cms_content_drafts"]["Row"];
        SetofOptions: {
          from: "*";
          to: "cms_content_drafts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      publish_package_catalog_draft: {
        Args: {
          p_actor_id: string;
          p_draft_id: string;
          p_expected_revision: number;
          p_initial_stripe_price_id: string;
          p_recurring_stripe_price_id: string;
          p_stripe_account_id: string;
          p_stripe_livemode: boolean;
          p_stripe_product_id: string;
        };
        Returns: Json;
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
      prepare_checkout_v2_reschedule: {
        Args: {
          p_actor_id: string;
          p_new_scheduled_at: string;
          p_request_id: string;
          p_session_id: string;
        };
        Returns: Database["public"]["Tables"]["checkout_v2_reschedule_operations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_reschedule_operations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      mark_checkout_v2_reschedule_outcome: {
        Args: {
          p_last_error: string;
          p_observed_stripe_anchor_at?: string | null;
          p_operation_id: string;
          p_status: string;
        };
        Returns: Database["public"]["Tables"]["checkout_v2_reschedule_operations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_reschedule_operations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      mark_stripe_payment_fee_reconciliation_pending: {
        Args: {
          p_attempted_at: string;
          p_error_code: string;
          p_payment_id: string;
          p_stripe_account_id: string;
          p_stripe_livemode: boolean;
        };
        Returns: Database["public"]["Tables"]["stripe_payment_fee_reconciliations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "stripe_payment_fee_reconciliations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      reconcile_checkout_v2_provisional_anchor: {
        Args: {
          p_expected_revision: number;
          p_new_first_local_date: string;
          p_observed_stripe_renewal_anchor_at: string;
          p_subscription_id: string;
        };
        Returns: Database["public"]["Tables"]["checkout_v2_billing_state"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_billing_state";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      reconcile_teacher_compensation_cycle: {
        Args: { p_admin_id: string; p_cycle_id: string };
        Returns: Database["public"]["Tables"]["teacher_compensation_cycle_terms"]["Row"];
        SetofOptions: {
          from: "*";
          to: "teacher_compensation_cycle_terms";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      reconcile_teacher_compensation_session: {
        Args: { p_admin_id: string; p_session_id: string };
        Returns: Database["public"]["Tables"]["teacher_compensation_ledger"]["Row"];
        SetofOptions: {
          from: "*";
          to: "teacher_compensation_ledger";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      reconcile_stripe_payment_fees: {
        Args: {
          p_amount_refunded_cents: number;
          p_charge_id: string;
          p_observed_at: string;
          p_payment_id: string;
          p_stripe_account_id: string;
          p_stripe_livemode: boolean;
          p_transactions: Json;
        };
        Returns: Database["public"]["Tables"]["stripe_payment_fee_reconciliations"]["Row"];
        SetofOptions: {
          from: "*";
          to: "stripe_payment_fee_reconciliations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      record_acquisition_cost_allocation: {
        Args: {
          p_admin_id: string;
          p_amount_cents: number;
          p_basis: string;
          p_campaign_id: string;
          p_checkout_attribution_event_id: string | null;
          p_reason: string | null;
          p_request_id: string;
          p_student_id: string;
        };
        Returns: Database["public"]["Tables"]["acquisition_cost_allocation_ledger"]["Row"];
        SetofOptions: {
          from: "*";
          to: "acquisition_cost_allocation_ledger";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      record_acquisition_attribution_event: {
        Args: {
          p_checkout_intent_id: string | null;
          p_entry_language: string;
          p_event_kind: string;
          p_landing_path: string;
          p_lead_id: string | null;
          p_referrer_host: string | null;
          p_referrer_kind: string;
          p_referrer_path: string | null;
          p_request_id: string;
          p_utm_campaign: string | null;
          p_utm_content: string | null;
          p_utm_medium: string | null;
          p_utm_source: string | null;
          p_utm_term: string | null;
        };
        Returns: Database["public"]["Tables"]["acquisition_attribution_events"]["Row"];
        SetofOptions: {
          from: "*";
          to: "acquisition_attribution_events";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      record_operational_cost: {
        Args: {
          p_admin_id: string;
          p_amount_cents: number;
          p_campaign_id: string | null;
          p_cost_kind: string;
          p_description: string;
          p_incurred_at: string;
          p_request_id: string;
          p_student_id: string | null;
        };
        Returns: Database["public"]["Tables"]["operational_cost_ledger"]["Row"];
        SetofOptions: {
          from: "*";
          to: "operational_cost_ledger";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      record_teacher_compensation_settlement_payment: {
        Args: {
          p_admin_id: string;
          p_invoice_reference: string | null;
          p_note: string;
          p_paid_at: string;
          p_payment_reference: string;
          p_request_id: string;
          p_settlement_id: string;
        };
        Returns: Database["public"]["Tables"]["teacher_compensation_settlement_payments"]["Row"];
        SetofOptions: {
          from: "*";
          to: "teacher_compensation_settlement_payments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      void_teacher_compensation_settlement_payment: {
        Args: {
          p_admin_id: string;
          p_payment_id: string;
          p_reason: string;
          p_request_id: string;
        };
        Returns: Database["public"]["Tables"]["teacher_compensation_settlement_payment_voids"]["Row"];
        SetofOptions: {
          from: "*";
          to: "teacher_compensation_settlement_payment_voids";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      record_teacher_compensation_work: {
        Args: {
          p_description: string;
          p_ended_at: string;
          p_recorded_by: string;
          p_request_id: string;
          p_started_at: string;
          p_teacher_id: string;
          p_work_kind: string;
        };
        Returns: Database["public"]["Tables"]["teacher_compensation_work_ledger"]["Row"];
        SetofOptions: {
          from: "*";
          to: "teacher_compensation_work_ledger";
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
      register_checkout_v2_price_snapshot: {
        Args: {
          p_initial_stripe_price_id: string;
          p_package_price_id: string;
          p_recurring_stripe_price_id: string;
          p_stripe_account_id: string;
          p_stripe_livemode: boolean;
        };
        Returns: Database["public"]["Tables"]["checkout_v2_price_snapshots"]["Row"];
        SetofOptions: {
          from: "*";
          to: "checkout_v2_price_snapshots";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      retire_versioned_package: {
        Args: {
          p_actor_id: string;
          p_package_id: string;
        };
        Returns: Json;
      };
      refresh_crm_no_show_contact_alarm: {
        Args: {
          p_contact_id: string;
          p_due_at: string;
          p_occurred_at: string;
          p_task_id: string;
        };
        Returns: boolean;
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
      rollback_cms_content_document: {
        Args: {
          p_actor_id: string;
          p_document_id: string;
          p_expected_current_version: number;
          p_operation_id: string;
          p_source_version: number;
        };
        Returns: Database["public"]["Tables"]["cms_documents"]["Row"];
        SetofOptions: {
          from: "*";
          to: "cms_documents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_cms_content_draft: {
        Args: {
          p_actor_id: string;
          p_draft_id: string;
          p_expected_revision: number;
          p_payload: Json;
        };
        Returns: Database["public"]["Tables"]["cms_content_drafts"]["Row"];
        SetofOptions: {
          from: "*";
          to: "cms_content_drafts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_package_catalog_draft: {
        Args: {
          p_actor_id: string;
          p_amount_cents: number;
          p_billing_interval_count: number;
          p_billing_interval_unit: string;
          p_class_duration_minutes: number;
          p_display_name: Json;
          p_draft_id: string;
          p_expected_revision: number;
          p_has_dual_teacher: boolean;
          p_has_group_session: boolean;
          p_is_publicly_listed: boolean;
          p_sessions_per_period: number;
        };
        Returns: Database["public"]["Tables"]["package_catalog_drafts"]["Row"];
        SetofOptions: {
          from: "*";
          to: "package_catalog_drafts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      admin_access_role:
        | "owner"
        | "content_editor"
        | "catalog_editor"
        | "operator"
        | "finance"
        | "viewer";
      admin_capability:
        | "dashboard.read"
        | "content.read"
        | "content.write"
        | "catalog.read"
        | "catalog.write"
        | "operations.read"
        | "operations.write"
        | "finance.read"
        | "finance.write"
        | "access.read"
        | "access.write";
      cms_content_draft_status: "draft" | "published" | "discarded";
      cms_content_locale: "es" | "en" | "ru";
      lead_status: "new" | "contacted" | "discarded";
      package_catalog_draft_status: "draft" | "published" | "discarded";
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
      admin_access_role: [
        "owner",
        "content_editor",
        "catalog_editor",
        "operator",
        "finance",
        "viewer",
      ],
      admin_capability: [
        "dashboard.read",
        "content.read",
        "content.write",
        "catalog.read",
        "catalog.write",
        "operations.read",
        "operations.write",
        "finance.read",
        "finance.write",
        "access.read",
        "access.write",
      ],
      cms_content_draft_status: ["draft", "published", "discarded"],
      cms_content_locale: ["es", "en", "ru"],
      lead_status: ["new", "contacted", "discarded"],
      package_catalog_draft_status: ["draft", "published", "discarded"],
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
