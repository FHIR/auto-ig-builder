package iger;

public class Req {
	
	private String service;
	private String org;
	private String repo;
	
	public String getOrg() {
		return org;
	}

	public void setOrg(String org) {
		this.org = org;
	}

	public String getRepo() {
		return repo;
	}

	public void setRepo(String repo) {
		this.repo = repo;
	}	

	public void setService(String t) {
		this.service = t;
	}

	public String getService() {
		return this.service;
	}

}
