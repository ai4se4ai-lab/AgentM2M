"use client";

import { PageHeader } from "@/components/nav/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OllamaTab } from "@/components/models/ollama-tab";
import { CloudTab } from "@/components/models/cloud-tab";

export default function ModelsPage() {
  return (
    <div>
      <PageHeader
        title="Model registry"
        description="Bind agent roles to a local Ollama model (real, free) or a cloud provider (UI shell only in this environment)."
      />
      <div className="p-8">
        <Tabs defaultValue="ollama">
          <TabsList>
            <TabsTrigger value="ollama">Ollama (local)</TabsTrigger>
            <TabsTrigger value="cloud">Cloud</TabsTrigger>
          </TabsList>
          <TabsContent value="ollama">
            <OllamaTab />
          </TabsContent>
          <TabsContent value="cloud">
            <CloudTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
