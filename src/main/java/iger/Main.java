package iger;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;

import com.amazonaws.auth.AWSCredentials;
import com.amazonaws.auth.DefaultAWSCredentialsProviderChain;
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3Client;
import com.amazonaws.services.s3.model.BucketWebsiteConfiguration;
import com.amazonaws.services.s3.model.CannedAccessControlList;
import com.amazonaws.services.s3.model.CreateBucketRequest;
import com.amazonaws.services.s3.transfer.MultipleFileUpload;
import com.amazonaws.services.s3.transfer.TransferManager;
import org.eclipse.jgit.api.Git;


public class Main {
	
	private static String DEFAULT_JEKYLL = "/var/task/ruby/bin/jekyll";

	public static void run(String... args) throws Exception {
		ProcessBuilder p = (new ProcessBuilder()).command(args).inheritIO();
		p.environment().put("PATH", p.environment().get("PATH").concat(":/var/task/ruby/bin"));
		p.start().waitFor();
	}

	public static String tempDir() throws IOException {
		return Files.createTempDirectory("tempfiles").toAbsolutePath().toString();
	}

	public static String build(Req req, Context context) throws Exception {
		String igClone = tempDir();
		String buildDir = tempDir();
		
		String jekyll = System.getProperty("jekyll") != null ? 
				System.getProperty("jekyll") : DEFAULT_JEKYLL;

		Git.cloneRepository()
		  .setURI(req.getSource())
		  .setDirectory(new File(igClone))
		  .call();

		run(jekyll, "build", "-s", igClone, "-d", buildDir);

		AWSCredentials creds = new DefaultAWSCredentialsProviderChain().getCredentials();
		AmazonS3 s3 = new AmazonS3Client(creds);
		TransferManager tx = new TransferManager(creds);

		createBucketIfNeeded(req, s3);
		uploadToBucket(req, buildDir, tx);

		return "Done building jekyll project: " + req.getSource();
	}

	private static void uploadToBucket(Req req, String buildDir, TransferManager tx) throws InterruptedException {
		MultipleFileUpload myUpload = tx.uploadDirectory(req.getTarget(), "", new File(buildDir), true);
		myUpload.waitForCompletion();
		tx.shutdownNow();
	}

	private static void createBucketIfNeeded(Req req, AmazonS3 s3) {
		if (!s3.doesBucketExist(req.getTarget())) {
			s3.createBucket(new CreateBucketRequest(req.getTarget()).withCannedAcl(CannedAccessControlList.PublicRead));
			s3.setBucketWebsiteConfiguration(req.getTarget(),
					new BucketWebsiteConfiguration("index.html", "error.html"));

			String policyJSON = "{" + 
					"\"Statement\": [{" + 
					"\"Effect\":\"Allow\"" + 
					",\"Action\":[\"s3:GetObject*\"]" +
					",\"Principal\":\"*\"" +
					",\"Resource\":\"arn:aws:s3:::" +
					req.getTarget() + 
					"/*\"" + 
					"}]}";

			s3.setBucketPolicy(req.getTarget(), policyJSON);
		}
	}

	public static void main(String[] args) throws Exception {
		System.out.println("Starting main");
		Req req = new Req();
		req.setSource("https://github.com/smart-on-fhir/smart-on-fhir.github.io");
		req.setTarget("smart-docs.ig.fhir.org");
		build(req, null);
		System.out.println("Finishing main");
	}

}