DROP INDEX "SourceEndpoint_url_key";
CREATE UNIQUE INDEX "SourceEndpoint_sourceId_url_key" ON "SourceEndpoint"("sourceId", "url");
