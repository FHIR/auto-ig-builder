-- Daily fhir-k8s cluster cost by node pool, service, SKU and cost class (resource-level billing export).
-- ${BILLING_EXPORT_TABLE} comes from config.env (never committed: it embeds the billing-account id).
SELECT FORMAT_TIMESTAMP('%Y-%m-%d', usage_start_time) day,
  (SELECT value FROM UNNEST(labels) WHERE key='goog-k8s-node-pool-name') pool,
  service.description service, sku.description sku,
  CASE WHEN sku.description LIKE '%Data Transfer%' OR sku.description LIKE '%Load Balancer%' THEN 'egress/net'
       WHEN sku.description LIKE 'Spot%' THEN 'spot compute'
       WHEN sku.description LIKE '%PD%' OR sku.description LIKE '%Storage%' THEN 'disk'
       WHEN service.description='Kubernetes Engine' THEN 'gke fee'
       ELSE 'on-demand compute/other' END cls,
  ROUND(SUM(cost),4) cost
FROM `${BILLING_EXPORT_TABLE}`
WHERE DATE(_PARTITIONTIME) >= '2026-02-01' AND project.id='${GCP_PROJECT}'
  AND (SELECT value FROM UNNEST(labels) WHERE key='goog-k8s-cluster-name')='fhir-k8s'
GROUP BY 1,2,3,4,5 HAVING ABS(cost) > 0.0001 ORDER BY 1, 6 DESC
