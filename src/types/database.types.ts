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
          updated_at?: stringë^´ÒÚ$z{-®éÜj×çC¢°¢&w3¢°¢öFÖ–åö–C¢7G&–æs°¢÷–ÖVçEö–C¢7G&–æs°¢÷&V6öã¢7G&–æs°¢÷&WVW7Eö–C¢7G&–æs°¢Ó°¢&WGW&ç3¢FF&6U²'V&Æ–2%Õ²%F&ÆW2%Õ²'FV6†W%ö6ö×Vç6F–öå÷6WGFÆVÖVçE÷–ÖVçE÷fö–G2%Õ²%&÷r%Ó°¢6WFöd÷F–öç3¢°¢g&öÓ¢"¢#°¢Fó¢'FV6†W%ö6ö×Vç6F–öå÷6WGFÆVÖVçE÷–ÖVçE÷fö–G2#°¢—4öæUFôöæS¢G'VS°¢—56WFöe&WGW&ã¢fÇ6S°¢Ó°¢Ó°¢&V6÷&E÷FV6†W%ö6ö×Vç6F–öå÷v÷&³¢°¢&w3¢°¢öFW67&—F–öã¢7G&–æs°¢öVæFVEöC¢7G&–æs°¢÷&V6÷&FVEö'“¢7G&–æs°¢÷&WVW7Eö–C¢7G&–æs°¢÷7F'FVEöC¢7G&–æs°¢÷FV6†W%ö–C¢7G&–æs°¢÷v÷&µö¶–æC¢7G&–æs°¢Ó°¢&WGW&ç3¢FF&6U²'V&Æ–2%Õ²%F&ÆW2%Õ²'FV6†W%ö6ö×Vç6F–öå÷v÷&µöÆVFvW"%Õ²%&÷r%Ó°¢6WFöd÷F–öç3¢°¢g&öÓ¢"¢#°¢Fó¢'FV6†W%ö6ö×Vç6F–öå÷v÷&µöÆVFvW"#°¢—4öæUFôöæS¢G'VS°¢—56WFöe&WGW&ã¢fÇ6S°¢Ó°¢Ó°¢&V6öæ6–ÆU÷7G&—U÷&VgVæC¢°¢&w3¢°¢öÖ÷VçE÷&VgVæFVC¢çVÖ&W#°¢÷–ÖVçEö–C¢7G&–æs°¢÷&VgVæFVEöC¢7G&–æs°¢÷7G&—U÷&VgVæEö–C¢7G&–æs°¢Ó°¢&WGW&ç3¢°¢Ö÷VçC¢çVÖ&W#°¢Ö÷VçE÷&VgVæFVC¢çVÖ&W#°¢7&VFVEöC¢7G&–ærÂçVÆÃ°¢7W'&Væ7“¢7G&–ærÂçVÆÃ°¢FW67&—F–öã¢7G&–ærÂçVÆÃ°¢–C¢7G&–æs°¢&VgVæFVEöC¢7G&–ærÂçVÆÃ°¢7FGW3¢FF&6U²'V&Æ–2%Õ²$VçV×2%Õ²'–ÖVçE÷7FGW2%ÒÂçVÆÃ°¢7G&—Uö–çfö–6Uö–C¢7G&–ærÂçVÆÃ°¢7G&—U÷–ÖVçEö–çFVçEö–C¢7G&–ærÂçVÆÃ°¢7G&—U÷&VgVæEö–C¢7G&–ærÂçVÆÃ°¢7GVFVçEö–C¢7G&–æs°¢7V'67&—F–öåö–C¢7G&–ærÂçVÆÃ°¢Ó°¢6WFöd÷F–öç3¢°¢g&öÓ¢"¢#°¢Fó¢'–ÖVçG2#°¢—4öæUFôöæS¢G'VS°¢—56WFöe&WGW&ã¢fÇ6S°¢Ó°¢Ó°¢&Vv—7FW%ö6†V6¶÷WE÷c%÷&–6U÷6æ6†÷C¢°¢&w3¢°¢ö–æ—F–Å÷7G&—U÷&–6Uö–C¢7G&–æs°¢÷6¶vU÷&–6Uö–C¢7G&–æs°¢÷&V7W'&–æu÷7G&—U÷&–6Uö–C¢7G&–æs°¢÷7G&—Uö66÷VçEö–C¢7G&–æs°¢÷7G&—UöÆ—fVÖöFS¢&ööÆVã°¢Ó°¢&WGW&ç3¢FF&6U²'V&Æ–2%Õ²%F&ÆW2%Õ²&6†V6¶÷WE÷c%÷&–6U÷6æ6†÷G2%Õ²%&÷r%Ó°¢6WFöd÷F–öç3¢°¢g&öÓ¢"¢#°¢Fó¢&6†V6¶÷WE÷c%÷&–6U÷6æ6†÷G2#°¢—4öæUFôöæS¢G'VS°¢—56WFöe&WGW&ã¢fÇ6S°¢Ó°¢Ó°¢&WF—&U÷fW'6–öæVE÷6¶vS¢°¢&w3¢°¢ö7F÷%ö–C¢7G&–æs°¢÷6¶vUö–C¢7G&–æs°¢Ó°¢&WGW&ç3¢§6öã°¢Ó°¢&Vg&W6…ö7&Õöæõ÷6†÷uö6öçF7EöÆ&Ó¢°¢&w3¢°¢ö6öçF7Eö–C¢7G&–æs°¢öGVUöC¢7G&–æs°¢öö67W'&VEöC¢7G&–æs°¢÷F6µö–C¢7G&–æs°¢Ó°¢&WGW&ç3¢&ööÆVã°¢Ó°¢&VÆV6Uö&æFöæVEö6†V6¶÷WEö–çFVçC¢°¢&w3¢²ö–çFVçEö–C¢7G&–æs²÷7G&—Uö7W7FöÖW%ö–C¢7G&–ærÓ°¢&WGW&ç3¢°¢6ö×ÆWFVEöC¢7G&–ærÂçVÆÃ°¢6öçF7Eö–C¢7G&–æs°¢7&VFVEöC¢7G&–æs°¢W‡—&W5öC¢7G&–æs°¢–C¢7G&–æs°¢Ææs¢7G&–æs°¢ÆVvÅ÷öÆ–7•÷fW'6–öã¢7G&–æs°¢÷÷'GVæ—G•ö–C¢7G&–æs°¢6¶vU÷&–6Uö–C¢7G&–æs°¢öÆ–7•ö66WFVEöC¢7G&–æs°¢6—FU÷W&Ã¢7G&–æs°¢7FGW3¢7G&–æs°¢7G&—Uö6†V6¶÷WE÷6W76–öåö–C¢7G&–ærÂçVÆÃ°¢7G&—Uö7W7FöÖW%ö–C¢7G&–ærÂçVÆÃ°¢7G&—U÷6W76–öåöW‡—&W5öC¢7G&–æs°¢7GVFVçEö–C¢7G&–æs°¢WFFVEöC¢7G&–æs°¢Ó°¢6WFöd÷F–öç3¢°¢g&öÓ¢"¢#°¢Fó¢&6†V6¶÷WEö–çFVçG2#°¢—4öæUFôöæS¢G'VS°¢—56WFöe&WGW&ã¢fÇ6S°¢Ó°¢Ó°¢&VÆV6Uö&öö¶&ÆU÷6Æ÷Eö†öÆC¢°¢&w3¢°¢ö6†V6¶÷WEö–çFVçEö–C¢7G&–æs°¢÷&V6öã¢7G&–æs°¢Ó°¢&WGW&ç3¢FF&6U²'V&Æ–2%Õ²%F&ÆW2%Õ²&&öö¶&ÆU÷6Æ÷Eö†öÆG2%Õ²%&÷r%Ó°¢6WFöd÷F–öç3¢°¢g&öÓ¢"¢#°¢Fó¢&&öö¶&ÆU÷6Æ÷Eö†öÆG2#°¢—4öæUFôöæS¢G'VS°¢—56WFöe&WGW&ã¢fÇ6S°¢Ó°¢Ó°¢&VÆV6UöW‡—&VEö6†V6¶÷WEö–çFVçC¢°¢&w3¢²ö–çFVçEö–C¢7G&–æs²÷7G&—Uö6†V6¶÷WE÷6W76–öåö–C¢7G&–ærÓ°¢&WGW&ç3¢°¢6ö×ÆWFVEöC¢7G&–ærÂçVÆÃ°¢6öçF7Eö–C¢7G&–æs°¢7&VFVEöC¢7G&–æs°¢W‡—&W5öC¢7G&–æs°¢–C¢7G&–æs°¢Ææs¢7G&–æs°¢ÆVvÅ÷öÆ–7•÷fW'6–öã¢7G&–æs°¢÷÷'GVæ—G•ö–C¢7G&–æs°¢6¶vU÷&–6Uö–C¢7G&–æs°¢öÆ–7•ö66WFVEöC¢7G&–æs°¢6—FU÷W&Ã¢7G&–æs°¢7FGW3¢7G&–æs°¢7G&—Uö6†V6¶÷WE÷6W76–öåö–C¢7G&–ærÂçVÆÃ°¢7G&—Uö7W7FöÖW%ö–C¢7G&–ærÂçVÆÃ°¢7G&—U÷6W76–öåöW‡—&W5öC¢7G&–æs°¢7GVFVçEö–C¢7G&–æs°¢WFFVEöC¢7G&–æs°¢Ó°¢6WFöd÷F–öç3¢°¢g&öÓ¢"¢#°¢Fó¢&6†V6¶÷WEö–çFVçG2#°¢—4öæUFôöæS¢G'VS°¢—56WFöe&WGW&ã¢fÇ6S°¢Ó°¢Ó°¢&VÆV6U÷7Fv–æuö–çFVw&F–öå÷6Öö¶UöÆV6S¢°¢&w3¢°¢övVæW&F–öã¢çVÖ&W#°¢öÆV6UöæÖS¢7G&–æs°¢ö÷væW%÷Fö¶Vã¢7G&–æs°¢÷'Våö–C¢7G&–æs°¢Ó°¢&WGW&ç3¢&ööÆVã°¢Ó°¢&VæWu÷7Fv–æuö–çFVw&F–öå÷6Öö¶UöÆV6S¢°¢&w3¢°¢övVæW&F–öã¢çVÖ&W#°¢öÆV6UöæÖS¢7G&–æs°¢ö÷væW%÷Fö¶Vã¢7G&–æs°¢÷'Våö–C¢7G&–æs°¢÷GFÅ÷6V6öæG3¢çVÖ&W#°¢Ó°¢&WGW&ç3¢°¢W‡—&W5öC¢7G&–æs°¢&VæWvVC¢&ööÆVã°¢ÕµÓ°¢Ó°¢&W6W'fUöVÖ–Å÷&V6—–VçEö'VFvWC¢°¢&w3¢°¢ö'VFvWE÷66÷S¢7G&–æs°¢öF–Ç•öÆ–Ö—C¢çVÖ&W#°¢öÖöçF†Ç•öÆ–Ö—C¢çVÖ&W#°¢÷&V6—–VçEö6÷VçC¢çVÖ&W#°¢÷6÷W&6S¢7G&–æs°¢Ó°¢&WGW&ç3¢°¢F–Ç•÷W6VC¢çVÖ&W#°¢ÖöçF†Ç•÷W6VC¢çVÖ&W#°¢ÕµÓ°¢Ó°¢6W76–öå÷G7G§&ævS¢°¢&w3¢²GW%öÖ–ã¢çVÖ&W#²7F'EöC¢7G&–ærÓ°¢&WGW&ç3¢Væ¶æ÷vã°¢Ó°¢6æ6†÷Eö6†V6¶÷WEö–çFVçEö7W7FöÖW#¢°¢&w3¢²ö–çFVçEö–C¢7G&–æs²÷7G&—Uö7W7FöÖW%ö–C¢7G&–ærÓ°¢&WGW&ç3¢°¢6ö×ÆWFVEöC¢7G&–ærÂçVÆÃ°¢6öçF7Eö–C¢7G&–æs°¢7&VFVEöC¢7G&–æs°¢W‡—&W5öC¢7G&–æs°¢–C¢7G&–æs°¢Ææs¢7G&–æs°¢ÆVvÅ÷öÆ–7•÷fW'6–öã¢7G&–æs°¢÷÷'GVæ—G•ö–C¢7G&–æs°¢6¶vU÷&–6Uö–C¢7G&–æs°¢öÆ–7•ö66WFVEöC¢7G&–æs°¢6—FU÷W&Ã¢7G&–æs°¢7FGW3¢7G&–æs°¢7G&—Uö6†V6¶÷WE÷6W76–öåö–C¢7G&–ærÂçVÆÃ°¢7G&—Uö7W7FöÖW%ö–C¢7G&–ærÂçVÆÃ°¢7G&—U÷6W76–öåöW‡—&W5öC¢7G&–æs°¢7GVFVçEö–C¢7G&–æs°¢WFFVEöC¢7G&–æs°¢Ó°¢6WFöd÷F–öç3¢°¢g&öÓ¢"¢#°¢Fó¢&6†V6¶÷WEö–çFVçG2#°¢—4öæUFôöæS¢G'VS°¢—56WFöe&WGW&ã¢fÇ6S°¢Ó°¢Ó°¢&öÆÆ&6µö6×5ö6öçFVçEöFö7VÖVçC¢°¢&w3¢°¢ö7F÷%ö–C¢7G&–æs°¢öFö7VÖVçEö–C¢7G&–æs°¢öW‡V7FVEö7W'&VçE÷fW'6–öã¢çVÖ&W#°¢ö÷W&F–öåö–C¢7G&–æs°¢÷6÷W&6U÷fW'6–öã¢çVÖ&W#°¢Ó°¢&WGW&ç3¢FF&6U²'V&Æ–2%Õ²%F&ÆW2%Õ²&6×5öFö7VÖVçG2%Õ²%&÷r%Ó°¢6WFöd÷F–öç3¢°¢g&öÓ¢"¢#°¢Fó¢&6×5öFö7VÖVçG2#°¢—4öæUFôöæS¢G'VS°¢—56WFöe&WGW&ã¢fÇ6S°¢Ó°¢Ó°¢WFFUö6×5ö6öçFVçEöG&gC¢°¢&w3¢°¢ö7F÷%ö–C¢7G&–æs°¢öG&gEö–C¢7G&–æs°¢öW‡V7FVE÷&Wf—6–öã¢çVÖ&W#°¢÷–ÆöC¢§6öã°¢Ó°¢&WGW&ç3¢FF&6U²'V&Æ–2%Õ²%F&ÆW2%Õ²&6×5ö6öçFVçEöG&gG2%Õ²%&÷r%Ó°¢6WFöd÷F–öç3¢°¢g&öÓ¢"¢#°¢Fó¢&6×5ö6öçFVçEöG&gG2#°¢—4öæUFôöæS¢G'VS°¢—56WFöe&WGW&ã¢fÇ6S°¢Ó°¢Ó°¢WFFU÷6¶vUö6FÆöuöG&gC¢°¢&w3¢°¢ö7F÷%ö–C¢7G&–æs°¢öÖ÷VçEö6VçG3¢çVÖ&W#°¢ö&–ÆÆ–æuö–çFW'fÅö6÷VçC¢çVÖ&W#°¢ö&–ÆÆ–æuö–çFW'fÅ÷Væ—C¢7G&–æs°¢ö6Æ75öGW&F–öåöÖ–çWFW3¢çVÖ&W#°¢öF—7Æ•öæÖS¢§6öã°¢öG&gEö–C¢7G&–æs°¢öW‡V7FVE÷&Wf—6–öã¢çVÖ&W#°¢ö†5öGVÅ÷FV6†W#¢&ööÆVã°¢ö†5öw&÷W÷6W76–öã¢&ööÆVã°¢ö—5÷V&Æ–6Ç•öÆ—7FVC¢&ööÆVã°¢÷6W76–öç5÷W%÷W&–öC¢çVÖ&W#°¢Ó°¢&WGW&ç3¢FF&6U²'V&Æ–2%Õ²%F&ÆW2%Õ²'6¶vUö6FÆöuöG&gG2%Õ²%&÷r%Ó°¢6WFöd÷F–öç3¢°¢g&öÓ¢"¢#°¢Fó¢'6¶vUö6FÆöuöG&gG2#°¢—4öæUFôöæS¢G'VS°¢—56WFöe&WGW&ã¢fÇ6S°¢Ó°¢Ó°¢Ó°¢VçV×3¢°¢FÖ–åö66W75÷&öÆS ¢Â&÷væW" ¢Â&6öçFVçEöVF—F÷" ¢Â&6FÆöuöVF—F÷" ¢Â&÷W&F÷" ¢Â&f–ææ6R ¢Â'f–WvW"#°¢FÖ–åö6&–Æ—G“ ¢Â&F6†&ö&Bç&VB ¢Â&6öçFVçBç&VB ¢Â&6öçFVçBçw&—FR ¢Â&6FÆörç&VB ¢Â&6FÆörçw&—FR ¢Â&÷W&F–öç2ç&VB ¢Â&÷W&F–öç2çw&—FR ¢Â&f–ææ6Rç&VB ¢Â&f–ææ6Rçw&—FR ¢Â&66W72ç&VB ¢Â&66W72çw&—FR#°¢6×5ö6öçFVçEöG&gE÷7FGW3¢&G&gB"Â'V&Æ—6†VB"Â&F—66&FVB#°¢6×5ö6öçFVçEöÆö6ÆS¢&W2"Â&Vâ"Â''R#°¢ÆVE÷7FGW3¢&æWr"Â&6öçF7FVB"Â&F—66&FVB#°¢6¶vUö6FÆöuöG&gE÷7FGW3¢&G&gB"Â'V&Æ—6†VB"Â&F—66&FVB#°¢–ÖVçE÷7FGW3¢'7V66VVFVB"Â'VæF–ær"Â&f–ÆVB"Â'&VgVæFVB#°¢7V'67&—F–öå÷7FGW3 ¢Â&7F—fR ¢Â'W6VB ¢Â&6æ6VÆÆVB ¢Â&W‡—&VB ¢Â'VæF–ær#°¢W6W%÷&öÆS¢'7GVFVçB"Â'FV6†W""Â&FÖ–â#°¢Ó°¢6ö×÷6—FUG—W3¢°¢µò–âæWfW%Ó¢æWfW#°¢Ó°¢Ó°§Ó° §G—RFF&6Uv—F†÷WD–çFW&æÇ2ÒöÖ—CÄFF&6RÂ%õô–çFW&æÅ7W&6R#ã° §G—RFVfVÇE66†VÖÒFF&6Uv—F†÷WD–çFW&æÇ5´W‡G&7CÀ¢¶W–öbFF&6RÀ¢'V&Æ–2 £åÓ° ¦W‡÷'BG—RF&ÆW3À¢FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç2W‡FVæG0¢Â¶W–öb„FVfVÇE66†VÖ²%F&ÆW2%ÒbFVfVÇE66†VÖ²%f–Ww2%Ò¢Â²66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ2ÒÀ¢F&ÆTæÖRW‡FVæG2FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç2W‡FVæG2°¢66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ3°¢Ğ¢ò¶W–öb„FF&6Uv—F†÷WD–çFW&æÇ5´FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç5²'66†VÖ%ÕÕ²%F&ÆW2%Ò`¢FF&6Uv—F†÷WD–çFW&æÇ5´FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç5²'66†VÖ%ÕÕ²%f–Ww2%Ò¢¢æWfW"ÒæWfW"À£âÒFVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç2W‡FVæG2°¢66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ3°§Ğ¢ò„FF&6Uv—F†÷WD–çFW&æÇ5´FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç5²'66†VÖ%ÕÕ²%F&ÆW2%Ò`¢FF&6Uv—F†÷WD–çFW&æÇ5´FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç5²'66†VÖ%ÕÕ²%f–Ww2%Ò•µF&ÆTæÖUÒW‡FVæG2°¢&÷s¢–æfW"#°¢Ğ¢ò ¢¢æWfW ¢¢FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç2W‡FVæG2¶W–öb„FVfVÇE66†VÖ²%F&ÆW2%Ò`¢FVfVÇE66†VÖ²%f–Ww2%Ò¢ò„FVfVÇE66†VÖ²%F&ÆW2%Ò`¢FVfVÇE66†VÖ²%f–Ww2%Ò•´FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç5ÒW‡FVæG2°¢&÷s¢–æfW"#°¢Ğ¢ò ¢¢æWfW ¢¢æWfW#° ¦W‡÷'BG—RF&ÆW4–ç6W'CÀ¢FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç2W‡FVæG0¢Â¶W–öbFVfVÇE66†VÖ²%F&ÆW2%Ğ¢Â²66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ2ÒÀ¢F&ÆTæÖRW‡FVæG2FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç2W‡FVæG2°¢66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ3°¢Ğ¢ò¶W–öbFF&6Uv—F†÷WD–çFW&æÇ5´FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç5²'66†VÖ%ÕÕ²%F&ÆW2%Ğ¢¢æWfW"ÒæWfW"À£âÒFVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç2W‡FVæG2°¢66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ3°§Ğ¢òFF&6Uv—F†÷WD–çFW&æÇ5´FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç5²'66†VÖ%ÕÕ²%F&ÆW2%ÕµF&ÆTæÖUÒW‡FVæG2°¢–ç6W'C¢–æfW"“°¢Ğ¢ò¢¢æWfW ¢¢FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç2W‡FVæG2¶W–öbFVfVÇE66†VÖ²%F&ÆW2%Ğ¢òFVfVÇE66†VÖ²%F&ÆW2%Õ´FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç5ÒW‡FVæG2°¢–ç6W'C¢–æfW"“°¢Ğ¢ò¢¢æWfW ¢¢æWfW#° ¦W‡÷'BG—RF&ÆW5WFFSÀ¢FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç2W‡FVæG0¢Â¶W–öbFVfVÇE66†VÖ²%F&ÆW2%Ğ¢Â²66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ2ÒÀ¢F&ÆTæÖRW‡FVæG2FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç2W‡FVæG2°¢66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ3°¢Ğ¢ò¶W–öbFF&6Uv—F†÷WD–çFW&æÇ5´FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç5²'66†VÖ%ÕÕ²%F&ÆW2%Ğ¢¢æWfW"ÒæWfW"À£âÒFVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç2W‡FVæG2°¢66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ3°§Ğ¢òFF&6Uv—F†÷WD–çFW&æÇ5´FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç5²'66†VÖ%ÕÕ²%F&ÆW2%ÕµF&ÆTæÖUÒW‡FVæG2°¢WFFS¢–æfW"S°¢Ğ¢òP¢¢æWfW ¢¢FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç2W‡FVæG2¶W–öbFVfVÇE66†VÖ²%F&ÆW2%Ğ¢òFVfVÇE66†VÖ²%F&ÆW2%Õ´FVfVÇE66†VÖF&ÆTæÖT÷$÷F–öç5ÒW‡FVæG2°¢WFFS¢–æfW"S°¢Ğ¢òP¢¢æWfW ¢¢æWfW#° ¦W‡÷'BG—RVçV×3À¢FVfVÇE66†VÖVçVÔæÖT÷$÷F–öç2W‡FVæG0¢Â¶W–öbFVfVÇE66†VÖ²$VçV×2%Ğ¢Â²66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ2ÒÀ¢VçVÔæÖRW‡FVæG2FVfVÇE66†VÖVçVÔæÖT÷$÷F–öç2W‡FVæG2°¢66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ3°¢Ğ¢ò¶W–öbFF&6Uv—F†÷WD–çFW&æÇ5´FVfVÇE66†VÖVçVÔæÖT÷$÷F–öç5²'66†VÖ%ÕÕ²$VçV×2%Ğ¢¢æWfW"ÒæWfW"À£âÒFVfVÇE66†VÖVçVÔæÖT÷$÷F–öç2W‡FVæG2°¢66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ3°§Ğ¢òFF&6Uv—F†÷WD–çFW&æÇ5´FVfVÇE66†VÖVçVÔæÖT÷$÷F–öç5²'66†VÖ%ÕÕ²$VçV×2%Õ´VçVÔæÖUĞ¢¢FVfVÇE66†VÖVçVÔæÖT÷$÷F–öç2W‡FVæG2¶W–öbFVfVÇE66†VÖ²$VçV×2%Ğ¢òFVfVÇE66†VÖ²$VçV×2%Õ´FVfVÇE66†VÖVçVÔæÖT÷$÷F–öç5Ğ¢¢æWfW#° ¦W‡÷'BG—R6ö×÷6—FUG—W3À¢V&Æ–46ö×÷6—FUG—TæÖT÷$÷F–öç2W‡FVæG0¢Â¶W–öbFVfVÇE66†VÖ²$6ö×÷6—FUG—W2%Ğ¢Â²66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ2ÒÀ¢6ö×÷6—FUG—TæÖRW‡FVæG2V&Æ–46ö×÷6—FUG—TæÖT÷$÷F–öç2W‡FVæG2°¢66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ3°¢Ğ¢ò¶W–öbFF&6Uv—F†÷WD–çFW&æÇ5µV&Æ–46ö×÷6—FUG—TæÖT÷$÷F–öç5²'66†VÖ%ÕÕ²$6ö×÷6—FUG—W2%Ğ¢¢æWfW"ÒæWfW"À£âÒV&Æ–46ö×÷6—FUG—TæÖT÷$÷F–öç2W‡FVæG2°¢66†VÖ¢¶W–öbFF&6Uv—F†÷WD–çFW&æÇ3°§Ğ¢òFF&6Uv—F†÷WD–çFW&æÇ5µV&Æ–46ö×÷6—FUG—TæÖT÷$÷F–öç5²'66†VÖ%ÕÕ²$6ö×÷6—FUG—W2%Õ´6ö×÷6—FUG—TæÖUĞ¢¢V&Æ–46ö×÷6—FUG—TæÖT÷$÷F–öç2W‡FVæG2¶W–öbFVfVÇE66†VÖ²$6ö×÷6—FUG—W2%Ğ¢òFVfVÇE66†VÖ²$6ö×÷6—FUG—W2%ÕµV&Æ–46ö×÷6—FUG—TæÖT÷$÷F–öç5Ğ¢¢æWfW#° ¦W‡÷'B6öç7B6öç7FçG2Ò°¢V&Æ–3¢°¢VçV×3¢°¢FÖ–åö66W75÷&öÆS¢°¢&÷væW""À¢&6öçFVçEöVF—F÷""À¢&6FÆöuöVF—F÷""À¢&÷W&F÷""À¢&f–ææ6R"À¢'f–WvW""À¢ÒÀ¢FÖ–åö6&–Æ—G“¢°¢&F6†&ö&Bç&VB"À¢&6öçFVçBç&VB"À¢&6öçFVçBçw&—FR"À¢&6FÆörç&VB"À¢&6FÆörçw&—FR"À¢&÷W&F–öç2ç&VB"À¢&÷W&F–öç2çw&—FR"À¢&f–ææ6Rç&VB"À¢&f–ææ6Rçw&—FR"À¢&66W72ç&VB"À¢&66W72çw&—FR"À¢ÒÀ¢6×5ö6öçFVçEöG&gE÷7FGW3¢²&G&gB"Â'V&Æ—6†VB"Â&F—66&FVB%ÒÀ¢6×5ö6öçFVçEöÆö6ÆS¢²&W2"Â&Vâ"Â''R%ÒÀ¢ÆVE÷7FGW3¢²&æWr"Â&6öçF7FVB"Â&F—66&FVB%ÒÀ¢6¶vUö6FÆöuöG&gE÷7FGW3¢²&G&gB"Â'V&Æ—6†VB"Â&F—66&FVB%ÒÀ¢–ÖVçE÷7FGW3¢²'7V66VVFVB"Â'VæF–ær"Â&f–ÆVB"Â'&VgVæFVB%ÒÀ¢7V'67&—F–öå÷7FGW3¢°¢&7F—fR"À¢'W6VB"À¢&6æ6VÆÆVB"À¢&W‡—&VB"À¢'VæF–ær"À¢ÒÀ¢W6W%÷&öÆS¢²'7GVFVçB"Â'FV6†W""Â&FÖ–â%ÒÀ¢ÒÀ¢ÒÀ§Ò26öç7C° 