// Generated from the Supabase schema (supabase/migrations); the unused helper types are omitted.
// Regenerate after schema changes rather than editing by hand.
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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      assessment_versions: {
        Row: {
          answers: Json
          api_version: string
          assessment_id: string
          created_at: string
          factors: Json
          id: string
          mapping_version: string
          recommendation_ids: Json
          result: Json
          risk_level: string
          rules_version: string
          schema_version: string
          score: number
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          answers: Json
          api_version?: string
          assessment_id: string
          created_at?: string
          factors?: Json
          id?: string
          mapping_version?: string
          recommendation_ids?: Json
          result: Json
          risk_level?: string
          rules_version?: string
          schema_version?: string
          score?: number
          status?: string
          updated_at?: string
          user_id?: string
          version: number
        }
        Update: {
          answers?: Json
          api_version?: string
          assessment_id?: string
          created_at?: string
          factors?: Json
          id?: string
          mapping_version?: string
          recommendation_ids?: Json
          result?: Json
          risk_level?: string
          rules_version?: string
          schema_version?: string
          score?: number
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "assessment_versions_assessment_id_user_id_fkey"
            columns: ["assessment_id", "user_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      assessments: {
        Row: {
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      assessment_register: {
        Row: {
          answers: Json | null
          assessment_id: string | null
          first_saved_at: string | null
          risk_level: string | null
          saved_at: string | null
          score: number | null
          status: string | null
          version: number | null
          version_count: number | null
          version_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      save_assessment_version: {
        Args: {
          scored_answers: Json
          scored_result: Json
          target_assessment: string
        }
        Returns: {
          answers: Json
          api_version: string
          assessment_id: string
          created_at: string
          factors: Json
          id: string
          mapping_version: string
          recommendation_ids: Json
          result: Json
          risk_level: string
          rules_version: string
          schema_version: string
          score: number
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "assessment_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
