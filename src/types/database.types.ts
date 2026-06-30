export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string | null
          after: Json | null
          before: Json | null
          created_at: string | null
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          admin_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          admin_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_activities: {
        Row: {
          activity_type: string
          actor_id: string | null
          body: string | null
          contact_id: string
          created_at: string | null
          id: string
          metadata: Json
          occurred_at: string
          opportunity_id: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          subject: string | null
        }
        Insert: {
          activity_type: string
          actor_id?: string | null
          body?: string | null
          contact_id: string
          created_at?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          opportunity_id?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          subject?: string | null
        }
        Update: {
          activity_type?: string
          actor_id?: string | null
          body?: string | null
          contact_id?: string
          created_at?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          opportunity_id?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "crm_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_consents: {
        Row: {
          captured_at: string | null
          channel: string
          contact_id: string
          created_at: string | null
          id: string
          legal_basis: string
          notice_version: string | null
          opted_out_at: string | null
          proof: string | null
          purpose: string
          source: string | null
          updated_at: string | null
        }
        Insert: {
          captured_at?: string | null
          channel: string
          contact_id: string
          created_at?: string | null
          id?: string
          legal_basis: string
          notice_version?: string | null
          opted_out_at?: string | null
          proof?: string | null
          purpose: string
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          captured_at?: string | null
          channel?: string
          contact_id?: string
          created_at?: string | null
          id?: string
          legal_basis?: string
          notice_version?: string | null
          opted_out_at?: string | null
          proof?: string | null
          purpose?: string
          source?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_consents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contacts: {
        Row: {
          country: string | null
          created_at: string | null
          full_name: string | null
          id: string
          last_contacted_at: string | null
          lifecycle_stage: string
          next_follow_up_at: string | null
          owner_id: string | null
          phone: string | null
          preferred_language: string | null
          primary_email: string
          profile_id: string | null
          source: string | null
          source_path: string | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          last_contacted_at?: string | null
          lifecycle_stage?: string
          next_follow_up_at?: string | null
          owner_id?: string | null
          phone?: string | null
          preferred_language?: string | null
          primary_email: string
          profile_id?: string | null
          source?: string | null
          source_path?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          last_contacted_at?: string | null
          lifecycle_stage?: string
          next_follow_up_at?: string | null
          owner_id?: string | null
          phone?: string | null
          preferred_language?: string | null
          primary_email?: string
          profile_id?: string | null
          source?: string | null
          source_path?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_opportunities: {
        Row: {
          assigned_to: string | null
          availability: string | null
          closed_at: string | null
          contact_id: string
          converted_subscription_id: string | null
          created_at: string | null
          current_level: string | null
          expected_value_cents: number | null
          id: string
          interest: string | null
          learning_goal: string | null
          legacy_lead_id: string | null
          lost_reason: string | null
          opened_at: string
          preferred_package_id: string | null
          probability_percent: number | null
          stage: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          availability?: string | null
          closed_at?: string | null
          contact_id: string
          converted_subscription_id?: string | null
          created_at?: string | null
          current_level?: string | null
          expected_value_cents?: number | null
          id?: string
          interest?: string | null
          learning_goal?: string | null
          legacy_lead_id?: string | null
          lost_reason?: string | null
          opened_at?: string
          preferred_package_id?: string | null
          probability_percent?: number | null
          stage?: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          availability?: string | null
          closed_at?: string | null
          contact_id?: string
          converted_subscription_id?: string | null
          created_at?: string | null
          current_level?: string | null
          expected_value_cents?: number | null
          id?: string
          interest?: string | null
          learning_goal?: string | null
          legacy_lead_id?: string | null
          lost_reason?: string | null
          opened_at?: string
          preferred_package_id?: string | null
          probability_percent?: number | null
          stage?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_opportunities_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_opportunities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_opportunities_converted_subscription_id_fkey"
            columns: ["converted_subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_opportunities_legacy_lead_id_fkey"
            columns: ["legacy_lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_opportunities_preferred_package_id_fkey"
            columns: ["preferred_package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          contact_id: string
          created_at: string | null
          due_at: string | null
          id: string
          metadata: Json
          opportunity_id: string | null
          priority: string
          related_entity_id: string | null
          related_entity_type: string | null
          status: string
          task_type: string
          title: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          contact_id: string
          created_at?: string | null
          due_at?: string | null
          id?: string
          metadata?: Json
          opportunity_id?: string | null
          priority?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          status?: string
          task_type?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          contact_id?: string
          created_at?: string | null
          due_at?: string | null
          id?: string
          metadata?: Json
          opportunity_id?: string | null
          priority?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          status?: string
          task_type?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_tasks_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "crm_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      fulfillment_jobs: {
        Row: {
          attempts: number
          created_at: string | null
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          run_at: string
          session_id: string | null
          status: string
          student_id: string | null
          subscription_id: string | null
          updated_at: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string | null
          id?: string
          job_type: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          run_at?: string
          session_id?: string | null
          status?: string
          student_id?: string | null
          subscription_id?: string | null
          updated_at?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          run_at?: string
          session_id?: string | null
          status?: string
          student_id?: string | null
          subscription_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fulfillment_jobs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfillment_jobs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfillment_jobs_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          created_at: string | null
          display_name: Json
          has_dual_teacher: boolean | null
          has_group_session: boolean | null
          id: string
          is_active: boolean | null
          name: string
          price_monthly: number
          sessions_per_month: number
          stripe_price_1m: string | null
          stripe_price_3m: string | null
          stripe_price_6m: string | null
          stripe_product_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_name: Json
          has_dual_teacher?: boolean | null
          has_group_session?: boolean | null
          id?: string
          is_active?: boolean | null
          name: string
          price_monthly: number
          sessions_per_month: number
          stripe_price_1m?: string | null
          stripe_price_3m?: string | null
          stripe_price_6m?: string | null
          stripe_product_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: Json
          has_dual_teacher?: boolean | null
          has_group_session?: boolean | null
          id?: string
          is_active?: boolean | null
          name?: string
          price_monthly?: number
          sessions_per_month?: number
          stripe_price_1m?: string | null
          stripe_price_3m?: string | null
          stripe_price_6m?: string | null
          stripe_product_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      leads: {
        Row: {
          consent_given: boolean
          created_at: string | null
          crm_contact_id: string | null
          crm_opportunity_id: string | null
          availability: string | null
          current_level: string | null
          email: string
          id: string
          interest: string | null
          ip_address: string | null
          is_russian_speaker: boolean
          lang: string | null
          level_check_confidence: string | null
          level_check_context: Json
          level_check_estimated_level: string | null
          level_check_fit_flags: string[]
          level_check_plan_recommendation: string | null
          level_check_raw_cleared_at: string | null
          level_check_received_at: string | null
          level_check_reviewed_at: string | null
          level_check_status: string
          level_check_summary: string | null
          learning_goal: string | null
          name: string | null
          preferred_package: string | null
          source_path: string | null
          spoken_languages: string[]
          status: Database["public"]["Enums"]["lead_status"] | null
          updated_at: string | null
        }
        Insert: {
          consent_given?: boolean
          created_at?: string | null
          crm_contact_id?: string | null
          crm_opportunity_id?: string | null
          availability?: string | null
          current_level?: string | null
          email: string
          id?: string
          interest?: string | null
          ip_address?: string | null
          is_russian_speaker?: boolean
          lang?: string | null
          level_check_confidence?: string | null
          level_check_context?: Json
          level_check_estimated_level?: string | null
          level_check_fit_flags?: string[]
          level_check_plan_recommendation?: string | null
          level_check_raw_cleared_at?: string | null
          level_check_received_at?: string | null
          level_check_reviewed_at?: string | null
          level_check_status?: string
          level_check_summary?: string | null
          learning_goal?: string | null
          name?: string | null
          preferred_package?: string | null
          source_path?: string | null
          spoken_languages?: string[]
          status?: Database["public"]["Enums"]["lead_status"] | null
          updated_at?: string | null
        }
        Update: {
          consent_given?: boolean
          created_at?: string | null
          crm_contact_id?: string | null
          crm_opportunity_id?: string | null
          availability?: string | null
          current_level?: string | null
          email?: string
          id?: string
          interest?: string | null
          ip_address?: string | null
          is_russian_speaker?: boolean
          lang?: string | null
          level_check_confidence?: string | null
          level_check_context?: Json
          level_check_estimated_level?: string | null
          level_check_fit_flags?: string[]
          level_check_plan_recommendation?: string | null
          level_check_raw_cleared_at?: string | null
          level_check_received_at?: string | null
          level_check_reviewed_at?: string | null
          level_check_status?: string
          level_check_summary?: string | null
          learning_goal?: string | null
          name?: string | null
          preferred_package?: string | null
          source_path?: string | null
          spoken_languages?: string[]
          status?: Database["public"]["Enums"]["lead_status"] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string | null
          currency: string | null
          description: string | null
          id: string
          status: Database["public"]["Enums"]["payment_status"] | null
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          student_id: string
          subscription_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          status?: Database["public"]["Enums"]["payment_status"] | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          student_id: string
          subscription_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          status?: Database["public"]["Enums"]["payment_status"] | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          student_id?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      processed_webhook_events: {
        Row: {
          created_at: string | null
          event_type: string
          stripe_event_id: string
        }
        Insert: {
          created_at?: string | null
          event_type: string
          stripe_event_id: string
        }
        Update: {
          created_at?: string | null
          event_type?: string
          stripe_event_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string
          full_name: string | null
          id: string
          phone: string | null
          preferred_language: string | null
          role: Database["public"]["Enums"]["user_role"] | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          full_name?: string | null
          id: string
          phone?: string | null
          preferred_language?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          preferred_language?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_crm_contact_id_fkey"
            columns: ["crm_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_crm_opportunity_id_fkey"
            columns: ["crm_opportunity_id"]
            isOneToOne: false
            referencedRelation: "crm_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles_private: {
        Row: {
          created_at: string | null
          current_level: string | null
          drive_folder_id: string | null
          drive_folder_url: string | null
          google_account_email: string | null
          notes: string | null
          profile_id: string
          stripe_customer_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_level?: string | null
          drive_folder_id?: string | null
          drive_folder_url?: string | null
          google_account_email?: string | null
          notes?: string | null
          profile_id: string
          stripe_customer_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_level?: string | null
          drive_folder_id?: string | null
          drive_folder_url?: string | null
          google_account_email?: string | null
          notes?: string | null
          profile_id?: string
          stripe_customer_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_private_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          calendar_event_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string | null
          drive_doc_id: string | null
          drive_doc_url: string | null
          duration_minutes: number | null
          id: string
          meet_link: string | null
          post_class_report: Json | null
          reminder_sent: boolean | null
          scheduled_at: string | null
          status: string | null
          student_id: string
          subscription_id: string
          teacher_id: string | null
          teacher_notes: string | null
          updated_at: string | null
        }
        Insert: {
          calendar_event_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string | null
          drive_doc_id?: string | null
          drive_doc_url?: string | null
          duration_minutes?: number | null
          id?: string
          meet_link?: string | null
          post_class_report?: Json | null
          reminder_sent?: boolean | null
          scheduled_at?: string | null
          status?: string | null
          student_id: string
          subscription_id: string
          teacher_id?: string | null
          teacher_notes?: string | null
          updated_at?: string | null
        }
        Update: {
          calendar_event_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string | null
          drive_doc_id?: string | null
          drive_doc_url?: string | null
          duration_minutes?: number | null
          id?: string
          meet_link?: string | null
          post_class_report?: Json | null
          reminder_sent?: boolean | null
          scheduled_at?: string | null
          status?: string | null
          student_id?: string
          subscription_id?: string
          teacher_id?: string | null
          teacher_notes?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_notes: string | null
          context: Json
          created_at: string | null
          id: string
          issue_title: string
          issue_type: string
          message: string
          page_url: string | null
          status: string
          updated_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          context?: Json
          created_at?: string | null
          id?: string
          issue_title: string
          issue_type: string
          message: string
          page_url?: string | null
          status?: string
          updated_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          context?: Json
          created_at?: string | null
          id?: string
          issue_title?: string
          issue_type?: string
          message?: string
          page_url?: string | null
          status?: string
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_teachers: {
        Row: {
          assigned_at: string | null
          id: string
          is_primary: boolean | null
          student_id: string
          teacher_id: string
        }
        Insert: {
          assigned_at?: string | null
          id?: string
          is_primary?: boolean | null
          student_id: string
          teacher_id: string
        }
        Update: {
          assigned_at?: string | null
          id?: string
          is_primary?: boolean | null
          student_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_teachers_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_teachers_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string | null
          duration_months: number
          ends_at: string
          id: string
          package_id: string
          sessions_total: number
          sessions_used: number | null
          starts_at: string
          status: Database["public"]["Enums"]["subscription_status"] | null
          stripe_invoice_id: string | null
          stripe_subscription_id: string | null
          student_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          duration_months: number
          ends_at: string
          id?: string
          package_id: string
          sessions_total: number
          sessions_used?: number | null
          starts_at: string
          status?: Database["public"]["Enums"]["subscription_status"] | null
          stripe_invoice_id?: string | null
          stripe_subscription_id?: string | null
          student_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          duration_months?: number
          ends_at?: string
          id?: string
          package_id?: string
          sessions_total?: number
          sessions_used?: number | null
          starts_at?: string
          status?: Database["public"]["Enums"]["subscription_status"] | null
          stripe_invoice_id?: string | null
          stripe_subscription_id?: string | null
          student_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_availability: {
        Row: {
          created_at: string | null
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean | null
          start_time: string
          teacher_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          end_time: string
          id?: string
          is_active?: boolean | null
          start_time: string
          teacher_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean | null
          start_time?: string
          teacher_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teacher_availability_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_available_slots: {
        Args: {
          p_date: string
          p_duration_minutes?: number
          p_teacher_id: string
        }
        Returns: {
          slot_end: string
          slot_start: string
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      lead_status: "new" | "contacted" | "discarded"
      payment_status: "succeeded" | "pending" | "failed" | "refunded"
      subscription_status:
      | "active"
      | "paused"
      | "cancelled"
      | "expired"
      | "pending"
      user_role: "student" | "teacher" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
  | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
  ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
    DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] &
    DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
  ? R
  : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Insert: infer I
  }
  ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Insert: infer I
  }
  ? I
  : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Update: infer U
  }
  ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Update: infer U
  }
  ? U
  : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
  | keyof DefaultSchema["Enums"]
  | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
  : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
  | keyof DefaultSchema["CompositeTypes"]
  | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
  : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

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
} as const
