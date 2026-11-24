-- Schema v7: resources (videos, courses, links, PDFs) attached to an experience on a skill's canvas,
-- beside the files from its focus session. Removing either side removes the attachment.
CREATE TABLE skill_node_resources (
  node_id INTEGER NOT NULL REFERENCES skill_nodes(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (node_id, resource_id)
);
CREATE INDEX skill_node_resources_resource ON skill_node_resources (resource_id);
